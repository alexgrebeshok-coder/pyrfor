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
}));

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-stub" />,
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
