import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  gitGetStatus,
  gitStageFiles,
  gitUnstageFiles,
  gitCommitFiles,
  getWorktreeMergeEvents,
  postWorktreeMerge,
  type GitStatusResult,
  type WorktreeMergeLedgerEvent,
} from '../lib/api';

interface GitPanelProps {
  workspace: string;
  onViewDiff?: (filePath: string, staged: boolean) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const MERGE_POLL_MS = 8000;

function mergeEventSummary(ev: WorktreeMergeLedgerEvent): string {
  if (ev.status === 'completed') return 'Merged';
  if (ev.status === 'conflicted') return 'Conflict';
  return 'Requested';
}

export default function GitPanel({ workspace, onViewDiff, onToast }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [mergeEvents, setMergeEvents] = useState<WorktreeMergeLedgerEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [retryingMergeRunId, setRetryingMergeRunId] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mergeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
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

  const refreshMergeEvents = useCallback(async () => {
    if (!workspace) return;
    try {
      const events = await getWorktreeMergeEvents(20);
      setMergeEvents(events);
    } catch {
      // ignore — daemon may be offline briefly
    }
  }, [workspace]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshMergeEvents()]);
  }, [refreshStatus, refreshMergeEvents]);

  // Poll status every 3 s; merge ledger every 8 s
  useEffect(() => {
    if (!workspace) return;
    void refreshAll();
    intervalRef.current = setInterval(refreshStatus, 3000);
    mergeIntervalRef.current = setInterval(refreshMergeEvents, MERGE_POLL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (mergeIntervalRef.current) clearInterval(mergeIntervalRef.current);
    };
  }, [workspace, refreshAll, refreshStatus, refreshMergeEvents]);

  const handleStage = useCallback(
    async (filePath: string, e: React.ChangeEvent<HTMLInputElement>) => {
      if (!workspace) return;
      try {
        if (e.target.checked) {
          await gitStageFiles(workspace, [filePath]);
        } else {
          await gitUnstageFiles(workspace, [filePath]);
        }
        await refreshStatus();
      } catch (err: any) {
        onToast?.(`Git error: ${err.message}`, 'error');
      }
    },
    [workspace, refreshStatus, onToast],
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
      await refreshStatus();
    } catch (err: any) {
      onToast?.(`Commit failed: ${err.message}`, 'error');
    } finally {
      setCommitting(false);
    }
  }, [workspace, commitMsg, refreshStatus, onToast]);

  const handleCommitKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  const handleRetrySubagentMerge = useCallback(
    async (runId: string) => {
      setRetryingMergeRunId(runId);
      try {
        const result = await postWorktreeMerge({ taskId: runId });
        if (result.ok && result.kind === 'completed') {
          onToast?.('Subagent branch merged', 'success');
        } else if (result.kind === 'conflict') {
          onToast?.('Merge conflict — resolve files or retry after fixing', 'error');
        } else {
          onToast?.(result.message ?? 'Merge failed', 'error');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Retry merge failed';
        onToast?.(msg, 'error');
      } finally {
        setRetryingMergeRunId(null);
        await refreshAll();
      }
    },
    [onToast, refreshAll],
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
          onClick={() => void refreshAll()}
          title="Refresh (status every 3s; subagent merges every 8s)"
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

      {/* Subagent merge ledger */}
      <section className="git-section">
        <div className="git-section__heading">Subagent merges</div>
        <p className="git-panel__hint git-merge-events__hint">
          Merge conflicts are aborted in the repo automatically. Retry runs a new merge and asks for approval
          again.
        </p>
        {mergeEvents.length === 0 ? (
          <div className="git-panel__hint">No recent subagent merge events</div>
        ) : (
          <ul className="git-file-list git-merge-events">
            {mergeEvents.map((ev) => (
              <li key={`${ev.run_id}-${ev.ts}-${ev.type}`} className="git-merge-event">
                <div className="git-merge-event__row">
                  <span
                    className={`git-merge-event__badge git-merge-event__badge--${ev.status}`}
                    title={ev.type}
                  >
                    {mergeEventSummary(ev)}
                  </span>
                  <span className="git-merge-event__branch" title={ev.merge_branch ?? ''}>
                    {ev.merge_branch ?? ev.run_id}
                  </span>
                  <span className="git-merge-event__time">{ev.ts.slice(0, 19)}</span>
                </div>
                {ev.status === 'completed' && ev.merge_sha !== undefined ? (
                  <div className="git-merge-event__meta">
                    SHA{' '}
                    {ev.merge_sha.length >= 8 ? ev.merge_sha.slice(0, 8) : ev.merge_sha}
                  </div>
                ) : null}
                {ev.reason !== undefined ? (
                  <div className="git-merge-event__meta">{ev.reason}</div>
                ) : null}
                {ev.status === 'conflicted' && ev.conflict_paths !== undefined ? (
                  <ul className="git-merge-event__conflicts">
                    {ev.conflict_paths.map((p) => (
                      <li key={p} className="git-file-item git-merge-conflict-row">
                        <span className="git-file-item__name">{p}</span>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => onViewDiff?.(p, false)}
                        >
                          View
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {ev.status === 'conflicted' ? (
                  <div className="git-merge-event__actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={retryingMergeRunId === ev.run_id}
                      onClick={() => void handleRetrySubagentMerge(ev.run_id)}
                    >
                      {retryingMergeRunId === ev.run_id ? 'Retrying…' : 'Retry merge'}
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

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
