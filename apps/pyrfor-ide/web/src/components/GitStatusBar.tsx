import React, { useState, useEffect, useCallback } from 'react';
import { gitGetStatus, type GitStatusResult } from '../lib/api';

interface GitStatusBarProps {
  workspace: string;
}

export default function GitStatusBar({ workspace }: GitStatusBarProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) return;
    try {
      const s = await gitGetStatus(workspace);
      setStatus(s);
    } catch {
      // not a git repo or network error — ignore silently
      setStatus(null);
    }
  }, [workspace]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!status) return null;

  const changedCount = status.files.length;
  const ahead = status.ahead;
  const behind = status.behind;

  return (
    <div className="git-status-bar" title={`Branch: ${status.branch}`}>
      <span className="git-status-bar__branch">⎇ {status.branch}</span>
      {ahead > 0 && <span className="git-status-bar__ahead">↑{ahead}</span>}
      {behind > 0 && <span className="git-status-bar__behind">↓{behind}</span>}
      {changedCount > 0 && (
        <span className="git-status-bar__dirty">• {changedCount} changed</span>
      )}
    </div>
  );
}
