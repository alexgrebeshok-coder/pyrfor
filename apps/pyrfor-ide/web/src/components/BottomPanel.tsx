import React, { useCallback, useEffect, useRef, useState } from 'react';
import Terminal from './Terminal';
import TrustPanel from './TrustPanel';
import OrchestrationPanel from './OrchestrationPanel';

export type BottomTab = 'Terminal' | 'Trust' | 'Orchestration' | 'Problems' | 'Output';

interface TerminalTab {
  id: string;
  label: string;
  cwd: string;
}

interface BottomPanelProps {
  cwd: string;
  collapsed: boolean;
  onToggle: () => void;
}

const BOTTOM_PANEL_HEIGHT_KEY = 'pyrfor-bottom-panel-h';
const DEFAULT_BOTTOM_HEIGHT = 280;
const MIN_BOTTOM_HEIGHT = 120;
const MAX_BOTTOM_VH = 0.6;

function readStoredHeight(): number {
  try {
    const raw = localStorage.getItem(BOTTOM_PANEL_HEIGHT_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_BOTTOM_HEIGHT) return parsed;
  } catch {
    // ignore
  }
  return DEFAULT_BOTTOM_HEIGHT;
}

let termCounter = 1;

export default function BottomPanel({ cwd, collapsed, onToggle }: BottomPanelProps) {
  const [activeSection, setActiveSection] = useState<BottomTab>('Terminal');
  const [termTabs, setTermTabs] = useState<TerminalTab[]>([
    { id: 'term-1', label: 'Terminal 1', cwd },
  ]);
  const [activeTermId, setActiveTermId] = useState<string>('term-1');
  const [panelHeight, setPanelHeight] = useState(readStoredHeight);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(BOTTOM_PANEL_HEIGHT_KEY, String(panelHeight));
    } catch {
      // ignore
    }
  }, [panelHeight]);

  const clampHeight = useCallback((value: number) => {
    const max = Math.floor(window.innerHeight * MAX_BOTTOM_VH);
    return Math.min(max, Math.max(MIN_BOTTOM_HEIGHT, value));
  }, []);

  const onResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    event.preventDefault();
    dragRef.current = { startY: event.clientY, startHeight: panelHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [collapsed, panelHeight]);

  const onResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = drag.startY - event.clientY;
    setPanelHeight(clampHeight(drag.startHeight + delta));
  }, [clampHeight]);

  const onResizePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const addTerminal = () => {
    termCounter += 1;
    const newTab: TerminalTab = { id: `term-${termCounter}`, label: `Terminal ${termCounter}`, cwd };
    setTermTabs((prev) => [...prev, newTab]);
    setActiveTermId(newTab.id);
    setActiveSection('Terminal');
  };

  const closeTerminal = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTermTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTermId === id) {
        setActiveTermId(next[next.length - 1]?.id ?? '');
      }
      return next;
    });
  };

  const style = collapsed
    ? undefined
    : ({ ['--bottom-panel-h' as string]: `${panelHeight}px` } as React.CSSProperties);

  return (
    <div id="bottom-panel" className={collapsed ? 'collapsed' : ''} style={style}>
      {!collapsed && (
        <div
          className="bottom-panel-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize bottom panel"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
        ></div>
      )}
      <div className="bottom-panel-toolbar">
        {(['Terminal', 'Trust', 'Orchestration', 'Problems', 'Output'] as BottomTab[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`bottom-section-tab${activeSection === s ? ' active' : ''}`}
            onClick={() => { setActiveSection(s); if (collapsed) onToggle(); }}
          >
            {s}
          </button>
        ))}

        {activeSection === 'Terminal' && !collapsed && (
          <div className="term-tabs">
            {termTabs.map((t) => (
              <span
                key={t.id}
                className={`term-tab${activeTermId === t.id ? ' active' : ''}`}
                onClick={() => setActiveTermId(t.id)}
              >
                {t.label}
                <button type="button" className="term-tab-close" onClick={(e) => closeTerminal(t.id, e)}>×</button>
              </span>
            ))}
            <button type="button" className="term-tab-add" onClick={addTerminal} title="New Terminal">+</button>
          </div>
        )}

        <div style={{ marginLeft: 'auto' }}>
          <button type="button" className="icon-btn" onClick={onToggle} title="Toggle panel (Cmd+J)">
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="bottom-panel-content">
          {activeSection === 'Terminal' && termTabs.map((t) => (
            <div
              key={t.id}
              className="bottom-terminal-pane"
              style={{ display: activeTermId === t.id ? 'block' : 'none' }}
            >
              <Terminal cwd={t.cwd} />
            </div>
          ))}
          {activeSection === 'Trust' && (
            <div className="bottom-panel-scroll">
              <TrustPanel />
            </div>
          )}
          {activeSection === 'Orchestration' && (
            <div className="bottom-panel-scroll">
              <OrchestrationPanel />
            </div>
          )}
          {activeSection === 'Problems' && (
            <div className="panel-placeholder">No problems detected.</div>
          )}
          {activeSection === 'Output' && (
            <div className="panel-placeholder">No output.</div>
          )}
        </div>
      )}
    </div>
  );
}
