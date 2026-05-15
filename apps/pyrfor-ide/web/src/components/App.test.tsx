import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { getDashboard, openWorkspace } from '../lib/api';

const mockInvoke = vi.fn();

vi.mock('../lib/api', () => ({
  getDashboard: vi.fn().mockResolvedValue({}),
  fsList: vi.fn().mockResolvedValue({ entries: [] }),
  fsRead: vi.fn().mockResolvedValue({ content: '', size: 0, path: '' }),
  fsWrite: vi.fn().mockResolvedValue(undefined),
  openWorkspace: vi.fn().mockResolvedValue({ workspaceRoot: '/tmp', cwd: '/tmp' }),
  chat: vi.fn().mockResolvedValue({ reply: '' }),
  exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 }),
  detectLanguage: vi.fn().mockReturnValue('plaintext'),
  getApiBase: vi.fn().mockReturnValue('http://localhost:18790'),
  gitGetStatus: vi.fn().mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, files: [] }),
  gitStageFiles: vi.fn().mockResolvedValue({ ok: true }),
  gitUnstageFiles: vi.fn().mockResolvedValue({ ok: true }),
  gitCommitFiles: vi.fn().mockResolvedValue({ sha: 'abc123' }),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('../components/SettingsModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="settings-modal-stub">
      <button onClick={onClose}>Close settings</button>
    </div>
  ),
  DEFAULT_SETTINGS: {
    version: 1,
    theme: 'auto',
    font: 'Menlo',
    fontSize: 13,
    lineHeight: 1.5,
    keybindings: {},
    logLevel: 'info',
  },
  isTauriRuntime: () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  tauriInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('../components/OnboardingWizard', () => ({
  default: () => <div data-testid="onboarding-wizard-stub" />,
}));

vi.mock('../components/UpdateNotifier', () => ({
  default: () => null,
}));

vi.mock('../components/GitPanel', () => ({
  default: () => <div data-testid="git-panel-stub" />,
}));

vi.mock('../components/TrustPanel', () => ({
  default: () => <div data-testid="trust-panel-stub" />,
}));

vi.mock('../components/OrchestrationPanel', () => ({
  default: () => <div data-testid="orchestration-panel-stub" />,
}));

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-stub" />,
  DiffEditor: () => <div data-testid="diff-editor-stub" />,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80; rows = 24;
    loadAddon() {} open() {} write() {} onData() {} onResize() {}
    dispose() {} fit() {}
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class { fit() {} activate() {} },
}));

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue(null);
  vi.clearAllMocks();
  try {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  } catch {
    // ignore
  }
  localStorage.removeItem('pyrfor-workspace');
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
});

describe('App smoke test', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeTruthy();
  });

  it('shows placeholder when no workspace', () => {
    render(<App />);
    expect(screen.getByTestId('editor-welcome')).toBeTruthy();
    expect(screen.getByTestId('welcome-open-folder')).toBeTruthy();
    expect(screen.getByTestId('welcome-clone-repo')).toBeTruthy();
    expect(screen.getByTestId('welcome-new-file')).toBeTruthy();
  });

  it('does not restore or keep legacy full workspace path from localStorage', async () => {
    localStorage.setItem('pyrfor-workspace', '/Users/alice/private-client/repo');

    render(<App />);

    await waitFor(() => {
      expect(localStorage.getItem('pyrfor-workspace')).toBeNull();
    });
    expect(document.body.textContent || '').not.toContain('/Users/alice/private-client');
    expect(document.body.textContent || '').not.toContain('private-client');
  });

  it('shows onboarding wizard on first Tauri launch', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'pyrfor_config_exists') return false;
      if (cmd === 'read_settings') {
        return {
          version: 1,
          theme: 'auto',
          font: 'Menlo',
          fontSize: 13,
          lineHeight: 1.5,
          keybindings: {},
          logLevel: 'info',
          onboardingComplete: false,
        };
      }
      return null;
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-wizard-stub')).toBeTruthy();
    });
  });

  it('switches the optional side panel between git, trust, and orchestration', () => {
    render(<App />);

    fireEvent.click(screen.getByTitle('Trust & approvals'));
    expect(screen.getByTestId('trust-panel-stub')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Runs & orchestration'));
    expect(screen.queryByTestId('trust-panel-stub')).toBeNull();
    expect(screen.getByTestId('orchestration-panel-stub')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Source Control (Cmd+Shift+G)'));
    expect(screen.queryByTestId('orchestration-panel-stub')).toBeNull();
    expect(screen.getByTestId('git-panel-stub')).toBeTruthy();
  });

  it('opens and closes the desktop application menu', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('topbar-menu-toggle'));
    expect(screen.getByTestId('topbar-menu')).toBeTruthy();

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByTestId('topbar-menu')).toBeNull();
    });
  });

  it('opens settings from the desktop application menu', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('topbar-menu-toggle'));
    fireEvent.click(screen.getByTestId('topbar-menu-settings'));

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal-stub')).toBeTruthy();
    });
  });

  it('opens a folder from the desktop application menu in browser mode', async () => {
    const openWorkspaceMock = openWorkspace as unknown as ReturnType<typeof vi.fn>;
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('/tmp/project');

    render(<App />);

    fireEvent.click(screen.getByTestId('topbar-menu-toggle'));
    fireEvent.click(screen.getByTestId('topbar-menu-open-folder'));

    await waitFor(() => {
      expect(openWorkspaceMock).toHaveBeenCalledWith('/tmp/project');
    });

    promptSpy.mockRestore();
  });

  it('creates a scratch file from the welcome state', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('welcome-new-file'));

    await waitFor(() => {
      expect(screen.getByText('untitled-1.md')).toBeTruthy();
      expect(screen.getByTestId('monaco-stub')).toBeTruthy();
    });
  });

  it('shows the file tree empty-state call to action when no workspace is open', () => {
    render(<App />);

    const emptyState = screen.getByTestId('filetree-empty-state');
    expect(emptyState).toBeTruthy();
    expect(emptyState.textContent || '').toContain('No folder open');
    expect(emptyState.textContent || '').toContain('Open Folder');
  });

  it('renders the governed strip when orchestration dashboard data is available', async () => {
    const getDashboardMock = getDashboard as unknown as ReturnType<typeof vi.fn>;
    getDashboardMock.mockResolvedValue({
      orchestration: {
        runs: {
          total: 7,
          active: 2,
          blocked: 1,
          latest: [
            {
              run_id: 'run-1234567890',
              task_id: 'task-1',
              workspace_id: 'ws',
              repo_id: 'repo',
              branch_or_worktree_id: 'main',
              mode: 'autonomous',
              status: 'blocked',
              artifact_refs: [],
              created_at: '2026-05-15T01:00:00.000Z',
              updated_at: '2026-05-15T01:05:00.000Z',
            },
          ],
        },
        dag: { total: 4, ready: 1, running: 1, blocked: 1 },
        effects: { pending: 3 },
        approvals: { pending: 2 },
        verifier: { blocked: 0, status: 'passed', latest: null },
        workerFrames: { total: 0, pending: 0, lastType: null },
        contextPack: null,
        overlays: { total: 0, domainIds: [] },
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('governance-strip')).toBeTruthy();
      expect(screen.getByTestId('governance-chip-approvals').textContent || '').toContain('2 pending');
      expect(screen.getByTestId('governance-chip-latest-run').textContent || '').toContain('blocked');
    });
  });

  it('opens the trust panel from the approvals chip in the governed strip', async () => {
    const getDashboardMock = getDashboard as unknown as ReturnType<typeof vi.fn>;
    getDashboardMock.mockResolvedValue({
      orchestration: {
        runs: { total: 1, active: 1, blocked: 0, latest: [] },
        dag: { total: 1, ready: 0, running: 1, blocked: 0 },
        effects: { pending: 0 },
        approvals: { pending: 1 },
        verifier: { blocked: 0, status: 'passed', latest: null },
        workerFrames: { total: 0, pending: 0, lastType: null },
        contextPack: null,
        overlays: { total: 0, domainIds: [] },
      },
    });

    render(<App />);

    fireEvent.click(await screen.findByTestId('governance-chip-approvals'));

    await waitFor(() => {
      expect(screen.getByTestId('trust-panel-stub')).toBeTruthy();
    });
  });

  it('opens the orchestration panel from the runs chip in the governed strip', async () => {
    const getDashboardMock = getDashboard as unknown as ReturnType<typeof vi.fn>;
    getDashboardMock.mockResolvedValue({
      orchestration: {
        runs: { total: 1, active: 1, blocked: 0, latest: [] },
        dag: { total: 1, ready: 0, running: 1, blocked: 0 },
        effects: { pending: 0 },
        approvals: { pending: 0 },
        verifier: { blocked: 0, status: 'passed', latest: null },
        workerFrames: { total: 0, pending: 0, lastType: null },
        contextPack: null,
        overlays: { total: 0, domainIds: [] },
      },
    });

    render(<App />);

    fireEvent.click(await screen.findByTestId('governance-chip-runs'));

    await waitFor(() => {
      expect(screen.getByTestId('orchestration-panel-stub')).toBeTruthy();
    });
  });
});
