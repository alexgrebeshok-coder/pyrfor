/**
 * WorkspaceSwitcher.tsx — Title-bar dropdown for switching workspaces (Phase E2).
 *
 * Shows current workspace, recent workspaces (up to 10), and "Open Folder…".
 * Cmd+Shift+R opens the picker.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceState } from '../state/workspace';

interface Props {
  onSwitch: (path: string) => void;
  hasDirtyTabs: boolean;
}

async function pickFolder(): Promise<string | null> {
  if ('__TAURI_INTERNALS__' in window) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const result = await open({ directory: true, multiple: false });
      return typeof result === 'string' ? result : null;
    } catch {
      return null;
    }
  }
  // Fallback for browser / test environment
  const path = window.prompt('Enter workspace path:');
  return path || null;
}

export default function WorkspaceSwitcher({ onSwitch, hasDirtyTabs }: Props) {
  const { state } = useWorkspaceState();
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const items = [
    ...state.recentWorkspaces.filter((r) => r !== state.workspace).slice(0, 9),
  ];

  const confirmSwitch = useCallback(
    (path: string) => {
      if (hasDirtyTabs && !window.confirm('You have unsaved changes. Switch workspace and discard?')) {
        return;
      }
      onSwitch(path);
      setOpen(false);
    },
    [hasDirtyTabs, onSwitch]
  );

  const handleOpenFolder = useCallback(async () => {
    setOpen(false);
    const selected = await pickFolder();
    if (selected) confirmSwitch(selected);
  }, [confirmSwitch]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keyboard navigation inside dropdown
  useEffect(() => {
    if (!open) return;
    const allItems = [...items, '__open__'];
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, allItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = allItems[focusIdx];
        if (sel === '__open__') handleOpenFolder();
        else confirmSwitch(sel);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, items, focusIdx, confirmSwitch, handleOpenFolder]);

  // Cmd+Shift+R global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        setFocusIdx(0);
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const label = state.workspace
    ? state.workspace.split('/').filter(Boolean).pop() || state.workspace
    : 'No workspace';

  return (
    <div className="workspace-switcher" ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="workspace-switcher-btn"
        title={state.workspace || 'No workspace open'}
        onClick={() => { setFocusIdx(0); setOpen((v) => !v); }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="workspace-switcher-label">{label}</span>
        <span style={{ marginLeft: 4, fontSize: '0.7em' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="workspace-switcher-dropdown"
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 1000,
            minWidth: 260,
            background: 'var(--bg-2, #1e1e1e)',
            border: '1px solid var(--border, #3c3c3c)',
            borderRadius: 4,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            padding: '4px 0',
          }}
        >
          {/* Current workspace (non-clickable) */}
          {state.workspace && (
            <div
              style={{
                padding: '6px 12px',
                fontSize: '0.75em',
                color: 'var(--fg-muted, #888)',
                borderBottom: '1px solid var(--border, #3c3c3c)',
              }}
            >
              {state.workspace}
            </div>
          )}

          {items.map((ws, idx) => (
            <button
              key={ws}
              role="option"
              aria-selected={idx === focusIdx}
              className={`workspace-switcher-item${idx === focusIdx ? ' focused' : ''}`}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 12px',
                background: idx === focusIdx ? 'var(--accent, #264f78)' : 'transparent',
                border: 'none',
                color: 'var(--fg, #ccc)',
                cursor: 'pointer',
                fontSize: '0.85em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              onClick={() => confirmSwitch(ws)}
              title={ws}
            >
              {ws.split('/').filter(Boolean).pop() || ws}
              <span style={{ marginLeft: 6, fontSize: '0.8em', color: 'var(--fg-muted, #666)' }}>
                {ws}
              </span>
            </button>
          ))}

          {items.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border, #3c3c3c)', margin: '4px 0' }} />
          )}

          <button
            role="option"
            aria-selected={focusIdx === items.length}
            className={`workspace-switcher-item${focusIdx === items.length ? ' focused' : ''}`}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 12px',
              background: focusIdx === items.length ? 'var(--accent, #264f78)' : 'transparent',
              border: 'none',
              color: 'var(--fg, #ccc)',
              cursor: 'pointer',
              fontSize: '0.85em',
            }}
            onClick={handleOpenFolder}
          >
            📂 Open Folder…
          </button>
        </div>
      )}
    </div>
  );
}
