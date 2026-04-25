import React, { useEffect, useState, useCallback } from 'react';
import { fsList, fsRead, FsEntry, detectLanguage } from '../lib/api';

interface FileTreeProps {
  root: string;
  activeFile: string | null;
  onFileOpen: (path: string, content: string, language: string) => void;
  onToast: (msg: string, type?: string, dur?: number) => void;
  searchRef?: React.Ref<HTMLInputElement>;
}

interface TreeNode {
  entry: FsEntry;
  depth: number;
  expanded?: boolean;
  loading?: boolean;
}

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export default function FileTree({
  root,
  activeFile,
  onFileOpen,
  onToast,
  searchRef,
}: FileTreeProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const loadDir = useCallback(
    async (path: string): Promise<FsEntry[]> => {
      try {
        const data = await fsList(path);
        return data.entries || [];
      } catch (err: any) {
        onToast(`Failed to load directory: ${err.message}`, 'error');
        return [];
      }
    },
    [onToast]
  );

  useEffect(() => {
    if (!root) {
      setNodes([]);
      return;
    }
    setLoading(true);
    loadDir(root).then((entries) => {
      setNodes(sortEntries(entries).map((e) => ({ entry: e, depth: 0 })));
      setLoading(false);
    });
  }, [root, loadDir]);

  const toggleFolder = useCallback(
    async (nodePath: string) => {
      // Find current state of the node
      let snapshotNode: TreeNode | undefined;
      let snapshotIdx = -1;
      setNodes((prev) => {
        snapshotIdx = prev.findIndex((n) => n.entry.path === nodePath);
        snapshotNode = snapshotIdx >= 0 ? prev[snapshotIdx] : undefined;
        if (!snapshotNode || snapshotNode.entry.type !== 'directory') return prev;

        if (snapshotNode.expanded) {
          // Collapse: remove descendants
          const depth = snapshotNode.depth;
          let endIdx = snapshotIdx + 1;
          while (endIdx < prev.length && prev[endIdx].depth > depth) endIdx++;
          const next = [...prev];
          next[snapshotIdx] = { ...snapshotNode, expanded: false };
          next.splice(snapshotIdx + 1, endIdx - snapshotIdx - 1);
          return next;
        } else {
          // Mark as loading; actual children appended after async load
          const next = [...prev];
          next[snapshotIdx] = { ...snapshotNode, expanded: true, loading: true };
          return next;
        }
      });

      if (!snapshotNode || snapshotNode.entry.type !== 'directory' || snapshotNode.expanded) {
        return;
      }

      const entries = await loadDir(snapshotNode.entry.path);
      setNodes((prev) => {
        const idx = prev.findIndex((n) => n.entry.path === nodePath);
        if (idx < 0) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], loading: false };
        const children: TreeNode[] = sortEntries(entries).map((e) => ({
          entry: e,
          depth: updated[idx].depth + 1,
        }));
        updated.splice(idx + 1, 0, ...children);
        return updated;
      });
    },
    [loadDir]
  );

  const handleNodeClick = useCallback(
    async (node: TreeNode) => {
      if (node.entry.type === 'directory') {
        toggleFolder(node.entry.path);
      } else {
        try {
          const data = await fsRead(node.entry.path);
          const lang = detectLanguage(node.entry.path);
          onFileOpen(node.entry.path, data.content || '', lang);
        } catch (err: any) {
          onToast(`Cannot open file: ${err.message}`, 'error');
        }
      }
    },
    [toggleFolder, onFileOpen, onToast]
  );

  const filtered = searchQuery
    ? nodes.filter((n) => {
        if (n.entry.type === 'directory') return true;
        const q = searchQuery.toLowerCase();
        return (
          n.entry.path.toLowerCase().includes(q) || n.entry.name.toLowerCase().includes(q)
        );
      })
    : nodes;

  return (
    <>
      <div className="panel-header">
        <span>Files</span>
        <button
          className="icon-btn"
          title="Search files (Ctrl+P)"
          onClick={() => setShowSearch((s) => !s)}
        >
          🔍
        </button>
      </div>
      {showSearch && (
        <div className="tree-search-bar">
          <input
            ref={searchRef}
            type="text"
            placeholder="Filter files…"
            autoComplete="off"
            spellCheck={false}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setShowSearch(false);
                setSearchQuery('');
              }
            }}
          />
        </div>
      )}
      <div id="file-tree" role="tree">
        {loading && (
          <div
            style={{
              color: 'var(--fg-2)',
              padding: '8px 12px',
              fontStyle: 'italic',
              fontSize: 12,
            }}
          >
            Loading…
          </div>
        )}
        {!loading && !root && (
          <div style={{ color: 'var(--fg-2)', padding: '8px 12px', fontSize: 12 }}>
            No folder open
          </div>
        )}
        {!loading && root && nodes.length === 0 && (
          <div style={{ color: 'var(--fg-2)', padding: '8px 12px', fontSize: 12 }}>
            No files found
          </div>
        )}
        {filtered.map((node) => {
          const isDir = node.entry.type === 'directory';
          const name =
            node.entry.name ||
            node.entry.path.split('/').filter(Boolean).pop() ||
            node.entry.path;
          return (
            <div
              key={node.entry.path}
              className={`tree-node${node.entry.path === activeFile ? ' active' : ''}${
                node.loading ? ' loading' : ''
              }`}
              role="treeitem"
              onClick={(e) => {
                e.stopPropagation();
                handleNodeClick(node);
              }}
            >
              <span className="tree-indent" style={{ width: `${node.depth * 14 + 4}px` }} />
              <span className="tree-toggle">
                {isDir ? (node.expanded ? '▾' : '▸') : ''}
              </span>
              <span className="tree-icon">{isDir ? (node.expanded ? '📂' : '📁') : '📄'}</span>
              <span className="tree-name">{name}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
