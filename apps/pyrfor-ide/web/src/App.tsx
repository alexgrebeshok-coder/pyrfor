import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileTree from './components/FileTree';
import TabBar from './components/TabBar';
import Editor from './components/Editor';
import ChatPanel from './components/ChatPanel';
import CommandRunner from './components/CommandRunner';
import BottomPanel from './components/BottomPanel';
import GitPanel from './components/GitPanel';
import GitStatusBar from './components/GitStatusBar';
import DiffView from './components/DiffView';
import Toast, { useToast } from './components/Toast';
import AuthModal from './components/AuthModal';
import HelpModal from './components/HelpModal';
import SettingsModal from './components/SettingsModal';
import WorkspaceSwitcher from './components/WorkspaceSwitcher';
import UpdateNotifier from './components/UpdateNotifier';
import { WorkspaceProvider, useWorkspaceState } from './state/workspace';
import { getDashboard, fsWrite, fsRead } from './lib/api';

export interface TabData {
  path: string;
  content: string;
  dirty: boolean;
  language: string;
}

function AppInner() {
  const wsCtx = useWorkspaceState();
  const [workspace, setWorkspaceLocal] = useState<string>(
    wsCtx.state.workspace ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('pyrfor-workspace')) ||
      ''
  );

  // Unified workspace setter: keeps local state, context, and localStorage in sync
  const setWorkspace = useCallback(
    (path: string) => {
      setWorkspaceLocal(path);
      localStorage.setItem('pyrfor-workspace', path);
      if (path) wsCtx.openWorkspace(path);
    },
    [wsCtx]
  );
  const [tabs, setTabs] = useState<TabData[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>('—');
  const [runnerCollapsed, setRunnerCollapsed] = useState(true);
  const [bottomCollapsed, setBottomCollapsed] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [gitDiffFile, setGitDiffFile] = useState<{ path: string; staged: boolean } | null>(null);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const treeSearchRef = useRef<HTMLInputElement>(null);
  const { toasts, showToast, dismissToast } = useToast();

  useEffect(() => {
    getDashboard()
      .then((data) => {
        if (data.model) setModelName(data.model);
        if (data.workspaceRoot || data.cwd) {
          const ws = data.workspaceRoot || data.cwd || '';
          if (ws && !workspace) {
            setWorkspace(ws);
          }
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenFolder = useCallback(async () => {
    if ('__TAURI_INTERNALS__' in window) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({ directory: true, multiple: false });
        if (selected && typeof selected === 'string') {
          setWorkspace(selected);
        }
      } catch {
        showToast('Tauri dialog unavailable', 'error');
      }
    } else {
      const path = prompt('Enter workspace path:');
      if (path) setWorkspace(path);
    }
  }, [showToast, setWorkspace]);

  const handleFileOpen = useCallback((path: string, content: string, language: string) => {
    setTabs((prev) => {
      if (prev.find((t) => t.path === path)) {
        setActiveTab(path);
        return prev;
      }
      const next = [...prev, { path, content, dirty: false, language }];
      setActiveTab(path);
      return next;
    });
  }, []);

  const handleTabSelect = useCallback((path: string) => {
    setActiveTab(path);
  }, []);

  const handleTabClose = useCallback((path: string) => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.path === path);
      if (tab?.dirty && !window.confirm('Discard unsaved changes?')) return prev;
      const idx = prev.findIndex((t) => t.path === path);
      const next = prev.filter((t) => t.path !== path);
      setActiveTab((cur) => {
        if (cur === path) {
          const adjacent = next[idx] || next[idx - 1] || null;
          return adjacent?.path ?? null;
        }
        return cur;
      });
      return next;
    });
  }, []);

  const handleContentChange = useCallback((path: string, content: string) => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, content, dirty: true } : t)));
  }, []);

  const handleSave = useCallback(async () => {
    const tab = tabs.find((t) => t.path === activeTab);
    if (!tab) return;
    try {
      await fsWrite(tab.path, tab.content);
      setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, dirty: false } : t)));
      showToast('Saved', 'success', 2000);
    } catch (err: any) {
      showToast(`Save failed: ${err.message}`, 'error');
    }
  }, [tabs, activeTab, showToast]);

  const handleSwitchWorkspace = useCallback(
    (path: string) => {
      // Close all tabs and switch workspace
      setTabs([]);
      setActiveTab(null);
      setWorkspace(path);
    },
    [setWorkspace]
  );

  const hasDirtyTabs = tabs.some((t) => t.dirty);

  const getActiveContent = useCallback(() => {
    return tabs.find((t) => t.path === activeTab)?.content ?? null;
  }, [tabs, activeTab]);

  const applyToActiveFile = useCallback(
    (path: string, content: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.path === path);
        if (idx === -1) {
          showToast('File not open', 'info');
          return prev;
        }
        const next = [...prev];
        next[idx] = { ...next[idx], content, dirty: true };
        return next;
      });
      showToast(`Applied to ${path}`, 'success', 2000);
    },
    [showToast]
  );

  useEffect(() => {
    if (!workspace) return;
    setRulesLoaded(false);
    fsRead(workspace + '/.pyrforrules')
      .then(() => setRulesLoaded(true))
      .catch(() => setRulesLoaded(false));
  }, [workspace]);

  // Hydrate tabs from persisted state once context loads
  useEffect(() => {
    if (!wsCtx.loaded) return;
    const persisted = wsCtx.state;
    if (persisted.workspace && !workspace) {
      setWorkspaceLocal(persisted.workspace);
      localStorage.setItem('pyrfor-workspace', persisted.workspace);
    }
    if (persisted.openTabs.length > 0 && tabs.length === 0 && (workspace || persisted.workspace)) {
      const root = workspace || persisted.workspace;
      persisted.openTabs.forEach((t) => {
        fsRead(t.path)
          .then((res) => {
            const lang = t.path.split('.').pop() || 'plaintext';
            setTabs((prev) => {
              if (prev.find((x) => x.path === t.path)) return prev;
              return [...prev, { path: t.path, content: res.content, dirty: false, language: lang }];
            });
            if (t.active) setActiveTab(t.path);
          })
          .catch(() => {});
      });
      // expand folders
      persisted.expandedFolders.forEach((f) => wsCtx.toggleFolder(f));
      void root; // used implicitly above
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsCtx.loaded]);

  // Sync active tab changes back to workspace context
  useEffect(() => {
    if (activeTab) wsCtx.setActiveTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Sync tab list back to workspace context (open/close)
  useEffect(() => {
    tabs.forEach((t) => wsCtx.openTab(t.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  // Force-save before window close
  useEffect(() => {
    const beforeUnload = () => { wsCtx.forceSave().catch(() => {}); };
    window.addEventListener('beforeunload', beforeUnload);
    // Tauri CloseRequested
    if ('__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('tauri://close-requested', () => {
          wsCtx.forceSave().catch(() => {});
        }).catch(() => {});
      });
    }
    return () => window.removeEventListener('beforeunload', beforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (gitDiffFile) {
          setGitDiffFile(null);
          return;
        }
        if (showAuthModal) {
          setShowAuthModal(false);
          return;
        }
        if (showHelpModal) {
          setShowHelpModal(false);
          return;
        }
        if (showSettingsModal) {
          setShowSettingsModal(false);
          return;
        }
      }
      if (
        e.key === '?' &&
        !['INPUT', 'TEXTAREA'].includes((document.activeElement as HTMLElement)?.tagName || '')
      ) {
        setShowHelpModal(true);
        return;
      }
      if (!mod) return;
      if (e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'p') {
        e.preventDefault();
        treeSearchRef.current?.focus();
      }
      if (e.key === 'e') {
        e.preventDefault();
        chatInputRef.current?.focus();
      }
      if (e.key === '`') {
        e.preventDefault();
        setRunnerCollapsed((c) => !c);
      }
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        setBottomCollapsed((c) => !c);
      }
      if (e.key === 'G' && e.shiftKey) {
        e.preventDefault();
        setShowGitPanel((v) => !v);
      }
      if (e.key === ',') {
        e.preventDefault();
        setShowSettingsModal((v) => !v);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleSave, showAuthModal, showHelpModal, showSettingsModal, gitDiffFile]);

  // Document title
  useEffect(() => {
    const tab = tabs.find((t) => t.path === activeTab);
    if (tab) {
      const name = tab.path.split('/').filter(Boolean).pop() || tab.path;
      document.title = `${tab.dirty ? '• ' : ''}${name} — Pyrfor IDE`;
    } else {
      document.title = 'Pyrfor IDE';
    }
  }, [tabs, activeTab]);

  const activeTabData = tabs.find((t) => t.path === activeTab) ?? null;

  return (
    <>
      <header id="topbar">
        <button
          className="icon-btn"
          onClick={() => {
            if (window.innerWidth < 768) {
              const treeOpen = mobileTreeOpen;
              if (!treeOpen) {
                setMobileTreeOpen(true);
                setMobileChatOpen(false);
              } else {
                setMobileTreeOpen(false);
                setMobileChatOpen(true);
              }
            }
          }}
          title="Toggle panels"
        >
          ☰
        </button>
        <WorkspaceSwitcher onSwitch={handleSwitchWorkspace} hasDirtyTabs={hasDirtyTabs} />
        <div className="topbar-actions">
          <span className="model-indicator">{modelName}</span>
          <button className="btn btn-sm" onClick={handleSave} title="Save (Ctrl+S)">
            Save
          </button>
          <button className="icon-btn" title="Open Folder" onClick={handleOpenFolder}>
            📂
          </button>
          <button
            className="icon-btn"
            title="Logout / clear token"
            onClick={() => {
              localStorage.removeItem('pyrfor-token');
              showToast('Token cleared', 'info', 2000);
            }}
          >
            ⏻
          </button>
          <button
            className="icon-btn"
            title="Keyboard shortcuts (?)"
            onClick={() => setShowHelpModal(true)}
          >
            ?
          </button>
          <button
            className={`icon-btn${showGitPanel ? ' active' : ''}`}
            title="Source Control (Cmd+Shift+G)"
            onClick={() => setShowGitPanel((v) => !v)}
          >
            ⎇
          </button>
        </div>
      </header>

      <div id="ide-layout">
        <aside id="panel-tree" className={`panel${mobileTreeOpen ? ' open' : ''}`}>
          <FileTree
            root={workspace}
            activeFile={activeTab}
            onFileOpen={handleFileOpen}
            onToast={showToast}
            searchRef={treeSearchRef}
          />
        </aside>

        {showGitPanel && (
          <aside id="panel-git" className="panel">
            <GitPanel
              workspace={workspace}
              onViewDiff={(filePath, staged) => setGitDiffFile({ path: filePath, staged })}
              onToast={showToast}
            />
          </aside>
        )}

        <main id="panel-editor" className="panel">
          <TabBar
            tabs={tabs}
            activeTab={activeTab}
            onSelect={handleTabSelect}
            onClose={handleTabClose}
          />
          <div id="editor-container">
            {activeTabData ? (
              <Editor tab={activeTabData} onChange={handleContentChange} onSave={handleSave} />
            ) : (
              <div className="editor-placeholder">
                <div className="placeholder-inner">
                  <div className="placeholder-logo">P</div>
                  {workspace ? (
                    <p>Open a file from the tree to start editing</p>
                  ) : (
                    <p>
                      <button className="btn btn-primary" onClick={handleOpenFolder}>
                        Open Folder
                      </button>
                    </p>
                  )}
                  <p className="placeholder-hint">
                    Ctrl+P to search files · Ctrl+E to chat · Ctrl+` to run commands
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>

        <aside id="panel-chat" className={`panel${mobileChatOpen ? ' open' : ''}`}>
          <ChatPanel
            cwd={workspace}
            workspace={workspace}
            tabs={tabs}
            activeTab={activeTab}
            onApplyToFile={applyToActiveFile}
            onOpenOrFocusTab={handleFileOpen}
            onToast={showToast}
            inputRef={chatInputRef}
            rulesLoaded={rulesLoaded}
          />
        </aside>
      </div>

      <CommandRunner
        cwd={workspace}
        collapsed={runnerCollapsed}
        onToggle={() => setRunnerCollapsed((c) => !c)}
        onToast={showToast}
      />

      <BottomPanel
        cwd={workspace}
        collapsed={bottomCollapsed}
        onToggle={() => setBottomCollapsed((c) => !c)}
      />

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}
      {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}
      {gitDiffFile && (
        <div className="diff-overlay">
          <DiffView
            workspace={workspace}
            filePath={gitDiffFile.path}
            staged={gitDiffFile.staged}
            onClose={() => setGitDiffFile(null)}
          />
        </div>
      )}

      <Toast toasts={toasts} onDismiss={dismissToast} />
      {workspace && <GitStatusBar workspace={workspace} />}
      <UpdateNotifier />
    </>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <AppInner />
    </WorkspaceProvider>
  );
}
