/**
 * workspace.ts — IDE workspace state context (Phase E2).
 *
 * Loads persisted state on mount via Tauri `read_ide_state`,
 * saves with a 1 s debounce on any change via `write_ide_state`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TabState {
  path: string;
  active: boolean;
  scrollTop: number;
  dirty?: boolean;
}

export interface WindowGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IdeState {
  version: 1;
  window: WindowGeometry;
  workspace: string;
  openTabs: TabState[];
  expandedFolders: string[];
  recentWorkspaces: string[];
}

const DEFAULT_STATE: IdeState = {
  version: 1,
  window: { x: 0, y: 0, w: 1280, h: 800 },
  workspace: '',
  openTabs: [],
  expandedFolders: [],
  recentWorkspaces: [],
};

// ─── Tauri invoke wrapper ─────────────────────────────────────────────────────

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  // JSDOM / browser test environment — no-op
  return undefined as unknown as T;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export interface WorkspaceContextValue {
  state: IdeState;
  loaded: boolean;
  openWorkspace: (path: string) => void;
  closeWorkspace: () => void;
  openTab: (path: string, scrollTop?: number) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  toggleFolder: (path: string) => void;
  addRecent: (path: string) => void;
  setScrollTop: (path: string, top: number) => void;
  forceSave: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 1000;
const MAX_RECENTS = 10;

function addRecentDedup(recents: string[], path: string): string[] {
  const next = [path, ...recents.filter((r) => r !== path)];
  return next.slice(0, MAX_RECENTS);
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<IdeState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted state on mount
  useEffect(() => {
    tauriInvoke<IdeState | null>('read_ide_state')
      .then((persisted) => {
        if (persisted && persisted.version === 1) {
          setState(persisted);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const scheduleSave = useCallback((next: IdeState) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      tauriInvoke('write_ide_state', { value: next }).catch(() => {});
    }, DEBOUNCE_MS);
  }, []);

  const update = useCallback(
    (fn: (prev: IdeState) => IdeState) => {
      setState((prev) => {
        const next = fn(prev);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  const forceSave = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    await tauriInvoke('write_ide_state', { value: state }).catch(() => {});
  }, [state]);

  const openWorkspace = useCallback(
    (path: string) => {
      update((prev) => ({
        ...prev,
        workspace: path,
        openTabs: [],
        expandedFolders: [],
        recentWorkspaces: addRecentDedup(prev.recentWorkspaces, path),
      }));
    },
    [update]
  );

  const closeWorkspace = useCallback(() => {
    update((prev) => ({ ...prev, workspace: '', openTabs: [], expandedFolders: [] }));
  }, [update]);

  const openTab = useCallback(
    (path: string, scrollTop = 0) => {
      update((prev) => {
        const exists = prev.openTabs.find((t) => t.path === path);
        const tabs = exists
          ? prev.openTabs.map((t) => ({ ...t, active: t.path === path }))
          : [
              ...prev.openTabs.map((t) => ({ ...t, active: false })),
              { path, active: true, scrollTop },
            ];
        return { ...prev, openTabs: tabs };
      });
    },
    [update]
  );

  const closeTab = useCallback(
    (path: string) => {
      update((prev) => {
        const idx = prev.openTabs.findIndex((t) => t.path === path);
        const next = prev.openTabs.filter((t) => t.path !== path);
        if (prev.openTabs[idx]?.active && next.length > 0) {
          const newActive = next[idx] ?? next[idx - 1];
          if (newActive) {
            return { ...prev, openTabs: next.map((t) => ({ ...t, active: t.path === newActive.path })) };
          }
        }
        return { ...prev, openTabs: next };
      });
    },
    [update]
  );

  const setActiveTab = useCallback(
    (path: string) => {
      update((prev) => ({
        ...prev,
        openTabs: prev.openTabs.map((t) => ({ ...t, active: t.path === path })),
      }));
    },
    [update]
  );

  const toggleFolder = useCallback(
    (path: string) => {
      update((prev) => {
        const expanded = prev.expandedFolders.includes(path)
          ? prev.expandedFolders.filter((f) => f !== path)
          : [...prev.expandedFolders, path];
        return { ...prev, expandedFolders: expanded };
      });
    },
    [update]
  );

  const addRecent = useCallback(
    (path: string) => {
      update((prev) => ({
        ...prev,
        recentWorkspaces: addRecentDedup(prev.recentWorkspaces, path),
      }));
    },
    [update]
  );

  const setScrollTop = useCallback(
    (path: string, top: number) => {
      update((prev) => ({
        ...prev,
        openTabs: prev.openTabs.map((t) => (t.path === path ? { ...t, scrollTop: top } : t)),
      }));
    },
    [update]
  );

  const value: WorkspaceContextValue = {
    state,
    loaded,
    openWorkspace,
    closeWorkspace,
    openTab,
    closeTab,
    setActiveTab,
    toggleFolder,
    addRecent,
    setScrollTop,
    forceSave,
  };

  return React.createElement(WorkspaceContext.Provider, { value }, children);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWorkspaceState(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspaceState must be used within <WorkspaceProvider>');
  return ctx;
}
