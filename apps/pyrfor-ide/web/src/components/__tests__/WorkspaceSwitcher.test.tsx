/**
 * WorkspaceSwitcher.test.tsx — Tests for the WorkspaceSwitcher component (Phase E2)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { WorkspaceProvider } from '../../state/workspace';
import WorkspaceSwitcher from '../WorkspaceSwitcher';

// Mock Tauri invoke — return null (no persisted state)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

// Mock dialog plugin
const mockOpen = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));

Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });

function renderSwitcher(onSwitch = vi.fn(), hasDirtyTabs = false) {
  return render(
    <WorkspaceProvider>
      <WorkspaceSwitcher onSwitch={onSwitch} hasDirtyTabs={hasDirtyTabs} />
    </WorkspaceProvider>
  );
}

describe('WorkspaceSwitcher', () => {
  beforeEach(() => {
    mockOpen.mockReset();
  });

  it('renders a button with the workspace label', async () => {
    renderSwitcher();
    expect(screen.getByRole('button', { name: /workspace/i })).toBeDefined();
  });

  it('opens dropdown on button click', async () => {
    renderSwitcher();
    const btn = screen.getAllByRole('button')[0];
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.getByText(/Open Folder/)).toBeDefined();
    });
  });

  it('calls dialog.open and onSwitch when "Open Folder…" clicked', async () => {
    const onSwitch = vi.fn();
    mockOpen.mockResolvedValue('/selected/workspace');
    renderSwitcher(onSwitch);
    // open dropdown
    fireEvent.click(screen.getAllByRole('button')[0]);
    // click "Open Folder…"
    const openBtn = await screen.findByText(/Open Folder/);
    await act(async () => { fireEvent.click(openBtn); });
    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
      expect(onSwitch).toHaveBeenCalledWith('/selected/workspace');
    });
  });

  it('does NOT call onSwitch when dialog returns null', async () => {
    const onSwitch = vi.fn();
    mockOpen.mockResolvedValue(null);
    renderSwitcher(onSwitch);
    fireEvent.click(screen.getAllByRole('button')[0]);
    const openBtn = await screen.findByText(/Open Folder/);
    await act(async () => { fireEvent.click(openBtn); });
    await waitFor(() => {
      expect(onSwitch).not.toHaveBeenCalled();
    });
  });

  it('asks confirmation before switching if hasDirtyTabs', async () => {
    const onSwitch = vi.fn();
    mockOpen.mockResolvedValue('/new/ws');
    // Override window.confirm to return false
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(false);
    renderSwitcher(onSwitch, true);
    fireEvent.click(screen.getAllByRole('button')[0]);
    const openBtn = await screen.findByText(/Open Folder/);
    await act(async () => { fireEvent.click(openBtn); });
    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
      expect(onSwitch).not.toHaveBeenCalled();
    });
    window.confirm = originalConfirm;
  });
});
