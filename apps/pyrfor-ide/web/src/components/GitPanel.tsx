import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  gitGetStatus,
  gitStageFiles,
  gitUnstageFiles,
  gitCommitFiles,
  type GitStatusResult,
} from '../lib/api';

interface GitPanelProps {
  workspace: string;
  onViewDiff?: (filePath: string, staged: boolean) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function GitPanel({ workspace, onViewDiff, onToast }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const s = await gitGetStatus(workspace);
      setStatus(s);
    } catch {
      // ignore fetch errors when panel is not focused
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  // Poll every 3 s while mounted
  useEffect(() => {
    if (!workspace) return;
    refresh();
    intervalRef.current = setInterval(refresh, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [workspace, refresh]);

  const handleStage = useCallback(
    async (filePath: string, e: React.ChangeEvent<HTMLInputElement>) => {
      if (!workspace) return;
      try {
        if (e.target.checked) {
          await gitStageFiles(workspace, [filePath]);
        } else {
          await gitUnstageFiles(workspace, [filePath]);
        }
        await refresh();
      } catch (err: any) {
        onToast?.(`Git error: ${err.message}`, 'error');
      }
    },
    [workspace, refresh, onToast],
  );

  const handleCommit = useCallback(async () => {
    if (!workspace || !commitMsg.trim()) {
      onToast?.('Commit message is required', 'error');
      return;
    }
    setCommitting(true);
    try {
      await gitCommitFiles(workspace, commitMsg.trim());
      setCommitMsg('');
      onToast?.('Committed', 'success');
      await refresh();
    } catch (err: any) {
      onToast?.(`Commit failed: ${err.message}`, 'error');
    } finally {
      setCommitting(false);
    }
  }, [workspace, commitMsg, refresh, onToast]);

  const handleCommitKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  if (!workspace) {
    return (
      <div className="git-panel git-panel--empty">
        <p className="git-panel__hint">Open a folder to use Git</p>
      </div>
    );
  }

  const staged = status?.files.filter((f) => f.x !== '.' && f.x !== '?') ?? [];
  const unstaged = status?.files.filter((f) => f.x === '.' || f.x === '?') ?? [];

  return (
    <div className="git-panel">
      <div className="git-panel__header">
        <span className="git-panel__title">Source Control</span>
        <button
          className="icon-btn git-panel__refresh"
          onClick={refresh}
          title="Refresh (also auto-refreshes every 3s)"
          disabled={loading}
        >
          ↺
        </button>
      </div>

      {/* Commit box */}
      <div className="git-panel__commit-area">
        <textarea
          className="git-panel__commit-msg"
          placeholder="Commit message (Cmd+Enter)"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={handleCommitKeyDown}
          rows={3}
        />
        <button
          className="btn btn-primary git-panel__commit-btn"
          onClick={handleCommit}
          disabled={committing || !commitMsg.trim()}
        >
          {committing ? 'Committing…' : 'Commit'}
        </button>
      </div>

      {/* Staged changes */}
      {staged.length > 0 && (
        <section className="git-section">
          <div className="git-section__heading">Staged ({staged.length})</div>
          <ul className="git-file-list">
            {staged.map((f) => (
              <li key={f.path} className="git-file-item">
                <input
                  type="checkbox"
                  checked
                  onChange={(e) => handleStage(f.path, e)}
                  title="Unstage"
                />
                <span
                  className="git-file-item__status git-status--staged"
                  title={`Index: ${f.x}  Worktree: ${f.y}`}
                >
                  {f.x}
                </span>
                <button
                  className="git-file-item__name"
                  onClick={() => onViewDiff?.(f.path, true)}
                  title={`View diff: ${f.path}`}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Unstaged / untracked changes */}
      {unstaged.length > 0 && (
        <section className="git-section">
          <div className="git-section__heading">Changes ({unstaged.length})</div>
          <ul className="git-file-list">
            {unstaged.map((f) => (
              <li key={f.path} className="git-file-item">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={(e) => handleStage(f.path, e)}
                  title="Stage"
                />
                <span
                  className="git-file-item__status git-status--unstaged"
                  title={`Index: ${f.x}  Worktree: ${f.y}`}
                >
                  {f.y}
                </span>
                <button
                  className="git-file-item__name"
                  onClick={() => onViewDiff?.(f.path, false)}
                  title={`View diff: ${f.path}`}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status && staged.length === 0 && unstaged.length === 0 && (
        <div className="git-panel__clean">No changes</div>
      )}
    </div>
  );
}
