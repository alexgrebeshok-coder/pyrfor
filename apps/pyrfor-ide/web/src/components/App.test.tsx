import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

vi.mock('../lib/api', () => ({
  getDashboard: vi.fn().mockResolvedValue({}),
  fsList: vi.fn().mockResolvedValue({ entries: [] }),
  fsRead: vi.fn().mockResolvedValue({ content: '', size: 0, path: '' }),
  fsWrite: vi.fn().mockResolvedValue(undefined),
  chat: vi.fn().mockResolvedValue({ reply: '' }),
  exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 }),
  detectLanguage: vi.fn().mockReturnValue('plaintext'),
  getApiBase: vi.fn().mockReturnValue('http://localhost:18790'),
  gitGetStatus: vi.fn().mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, files: [] }),
  gitStageFiles: vi.fn().mockResolvedValue({ ok: true }),
  gitUnstageFiles: vi.fn().mockResolvedValue({ ok: true }),
  gitCommitFiles: vi.fn().mockResolvedValue({ sha: 'abc123' }),
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

describe('App smoke test', () => {
  it('renders without crashing', () => {
    localStorage.removeItem('pyrfor-workspace');
    render(<App />);
    expect(document.body).toBeTruthy();
  });

  it('shows placeholder when no workspace', () => {
    localStorage.removeItem('pyrfor-workspace');
    render(<App />);
    expect(screen.getAllByText(/Open Folder/i).length).toBeGreaterThan(0);
  });
});
