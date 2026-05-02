import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

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
  default: () => null,
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
  try {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  } catch {
    // ignore
  }
  localStorage.removeItem('pyrfor-workspace');
});

describe('App smoke test', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeTruthy();
  });

  it('shows placeholder when no workspace', () => {
    render(<App />);
    expect(screen.getAllByText(/Open Folder/i).length).toBeGreaterThan(0);
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
});
