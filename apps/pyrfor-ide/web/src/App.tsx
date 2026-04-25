import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileTree from './components/FileTree';
import TabBar from './components/TabBar';
import Editor from './components/Editor';
import ChatPanel from './components/ChatPanel';
import CommandRunner from './components/CommandRunner';
import Toast, { useToast } from './components/Toast';
import AuthModal from './components/AuthModal';
import HelpModal from './components/HelpModal';
import { getDashboard, fsWrite } from './lib/api';

export interface TabData {
  path: string;
  content: string;
  dirty: boolean;
  language: string;
}

export default function App() {
  const [workspace, setWorkspace] = useState<string>(
    (typeof localStorage !== 'undefined' && localStorage.getItem('pyrfor-workspace')) || ''
  );
  const [tabs, setTabs] = useState<TabData[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>('—');
  const [runnerCollapsed, setRunnerCollapsed] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
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
            localStorage.setItem('pyrfor-workspace', ws);
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
          localStorage.setItem('pyrfor-workspace', selected);
        }
      } catch {
        showToast('Tauri dialog unavailable', 'error');
      }
    } else {
      const path = prompt('Enter workspace path:');
      if (path) {
        setWorkspace(path);
        localStorage.setItem('pyrfor-workspace', path);
      }
    }
  }, [showToast]);

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

  const getActiveContent = useCallback(() => {
    return tabs.find((t) => t.path === activeTab)?.content ?? null;
  }, [tabs, activeTab]);

  const applyToActiveFile = useCallback(
    (code: string) => {
      if (!activeTab) {
        showToast('No active file', 'error');
        return;
      }
      setTabs((prev) =>
        prev.map((t) => (t.path === activeTab ? { ...t, content: code, dirty: true } : t))
      );
      showToast('Code applied to active file', 'success', 2000);
    },
    [activeTab, showToast]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (showAuthModal) {
          setShowAuthModal(false);
          return;
        }
        if (showHelpModal) {
          setShowHelpModal(false);
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
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleSave, showAuthModal, showHelpModal]);

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
        <span className="workspace-label" title={workspace || '/'}>
          {workspace || '/'}
        </span>
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
            getActiveContent={getActiveContent}
            activeFilePath={activeTab}
            onApplyToFile={applyToActiveFile}
            onToast={showToast}
            inputRef={chatInputRef}
          />
        </aside>
      </div>

      <CommandRunner
        cwd={workspace}
        collapsed={runnerCollapsed}
        onToggle={() => setRunnerCollapsed((c) => !c)}
        onToast={showToast}
      />

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
