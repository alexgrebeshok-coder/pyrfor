import React, { useState } from 'react';
import Terminal from './Terminal';

export type BottomTab = 'Terminal' | 'Problems' | 'Output';

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

let termCounter = 1;

export default function BottomPanel({ cwd, collapsed, onToggle }: BottomPanelProps) {
  const [activeSection, setActiveSection] = useState<BottomTab>('Terminal');
  const [termTabs, setTermTabs] = useState<TerminalTab[]>([
    { id: 'term-1', label: 'Terminal 1', cwd },
  ]);
  const [activeTermId, setActiveTermId] = useState<string>('term-1');

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

  return (
    <div id="bottom-panel" className={collapsed ? 'collapsed' : ''}>
      <div className="bottom-panel-toolbar">
        {(['Terminal', 'Problems', 'Output'] as BottomTab[]).map((s) => (
          <button
            key={s}
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
                <button className="term-tab-close" onClick={(e) => closeTerminal(t.id, e)}>×</button>
              </span>
            ))}
            <button className="term-tab-add" onClick={addTerminal} title="New Terminal">+</button>
          </div>
        )}

        <div style={{ marginLeft: 'auto' }}>
          <button className="icon-btn" onClick={onToggle} title="Toggle panel (Cmd+J)">
            {collapsed ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="bottom-panel-content">
          {activeSection === 'Terminal' && termTabs.map((t) => (
            <div
              key={t.id}
              style={{ display: activeTermId === t.id ? 'block' : 'none', width: '100%', height: '100%' }}
            >
              <Terminal cwd={t.cwd} />
            </div>
          ))}
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
