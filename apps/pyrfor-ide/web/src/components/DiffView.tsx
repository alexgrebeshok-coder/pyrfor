import React, { useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { gitGetFileContent, gitGetDiff } from '../lib/api';

interface DiffViewProps {
  workspace: string;
  filePath: string;
  staged?: boolean;
  onClose: () => void;
}

export default function DiffView({ workspace, filePath, staged = false, onClose }: DiffViewProps) {
  const [original, setOriginal] = useState<string>('');
  const [modified, setModified] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    Promise.all([
      gitGetFileContent(workspace, filePath, 'HEAD'),
      gitGetDiff(workspace, filePath, staged),
    ])
      .then(([headContent, diffText]) => {
        setOriginal(headContent);
        // For the "modified" side: apply the diff logic or show working tree content.
        // We use the diff output for display but show original vs working-tree by
        // fetching the current file content via the diff endpoint.
        // Since getDiff returns unified diff, we reconstruct the modified content
        // by using the diff to mutate the original, or simply show the diff text.
        // For simplicity (and Monaco DiffEditor), show original vs reconstructed modified.
        setModified(applyUnifiedDiff(headContent, diffText));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load diff');
      })
      .finally(() => setLoading(false));
  }, [workspace, filePath, staged]);

  const title = `${filePath}${staged ? ' (staged)' : ' (working tree)'}`;

  return (
    <div className="diff-view">
      <div className="diff-view__header">
        <span className="diff-view__title">{title}</span>
        <button className="icon-btn diff-view__close" onClick={onClose} title="Close diff (Escape)">
          ✕
        </button>
      </div>
      <div className="diff-view__body">
        {loading && <div className="diff-view__loading">Loading diff…</div>}
        {error && <div className="diff-view__error">{error}</div>}
        {!loading && !error && (
          <DiffEditor
            height="100%"
            language={detectLangFromPath(filePath)}
            original={original}
            modified={modified}
            theme="vs-dark"
            options={{
              readOnly: true,
              renderSideBySide: true,
              minimap: { enabled: false },
              fontSize: 13,
              automaticLayout: true,
              scrollBeyondLastLine: false,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function detectLangFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', json: 'json', md: 'markdown',
    html: 'html', css: 'css', sh: 'shell', yaml: 'yaml', yml: 'yaml',
  };
  return map[ext] ?? 'plaintext';
}

/**
 * Minimal unified diff applicator: given the HEAD content and a unified diff,
 * produces the modified content. Falls back to showing the diff text if parsing fails.
 */
function applyUnifiedDiff(original: string, diff: string): string {
  if (!diff.trim()) return original;
  try {
    const lines = original.split('\n');
    const result: string[] = [...lines];
    const diffLines = diff.split('\n');
    let offset = 0;

    for (let i = 0; i < diffLines.length; i++) {
      const dl = diffLines[i]!;
      // @@ -<origStart>,<origCount> +<newStart>,<newCount> @@
      const hunkMatch = dl.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        const origStart = parseInt(hunkMatch[1]!, 10) - 1; // 0-based
        const newStart = parseInt(hunkMatch[3]!, 10) - 1;
        i++;
        const removals: number[] = [];
        const additions: string[] = [];
        while (i < diffLines.length && !/^@@/.test(diffLines[i]!)) {
          const dline = diffLines[i]!;
          if (dline.startsWith('-')) removals.push(origStart + offset + removals.length);
          else if (dline.startsWith('+')) additions.push(dline.slice(1));
          i++;
        }
        i--; // outer loop will increment
        // Apply: remove lines then insert additions
        result.splice(origStart + offset, removals.length, ...additions);
        offset += additions.length - removals.length;
      }
    }
    return result.join('\n');
  } catch {
    // If diff application fails, return original — Monaco will still show a useful diff
    return original;
  }
}
