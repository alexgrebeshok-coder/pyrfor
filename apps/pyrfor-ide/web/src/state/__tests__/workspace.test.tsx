/**
 * workspace.test.tsx — Unit tests for WorkspaceProvider / useWorkspaceState (Phase E2)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { WorkspaceProvider, useWorkspaceState } from '../workspace';

// Mock Tauri invoke
const mockReadResult: Record<string, unknown> = {};
let invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Stub window.__TAURI_INTERNALS__ so the code enters the Tauri branch
Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });

// Helper component that exposes context value via a ref
function Consumer({ onRender }: { onRender: (v: ReturnType<typeof useWorkspaceState>) => void }) {
  const ctx = useWorkspaceState();
  onRender(ctx);
  return null;
}

function makeWrapper() {
  let captured: ReturnType<typeof useWorkspaceState>;
  const wrapper = () => (
    <WorkspaceProvider>
      <Consumer onRender={(v) => { captured = v; }} />
    </WorkspaceProvider>
  );
  return { wrapper, getCtx: () => captured! };
}

beforeEach(() => {
  invokeMock = vi.fn().mockResolvedValue(null);
  mockReadResult['read_ide_state'] = null;
});

describe('WorkspaceProvider', () => {
  it('loads null state and defaults to empty workspace', async () => {
    invokeMock.mockResolvedValue(null);
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => expect(getCtx().loaded).toBe(true));
    expect(getCtx().state.workspace).toBe('');
    expect(getCtx().state.openTabs).toHaveLength(0);
  });

  it('hydrates from persisted state', async () => {
    invokeMock.mockResolvedValue({
      version: 1,
      workspace: '/abs/path',
      openTabs: [{ path: '/abs/path/foo.ts', active: true, scrollTop: 0 }],
      expandedFolders: ['/abs/path/src'],
      recentWorkspaces: ['/abs/path'],
      window: { x: 0, y: 0, w: 1280, h: 800 },
    });
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => expect(getCtx().loaded).toBe(true));
    expect(getCtx().state.workspace).toBe('/abs/path');
    expect(getCtx().state.openTabs).toHaveLength(1);
  });

  it('openWorkspace updates workspace and recents', async () => {
    invokeMock.mockResolvedValue(null);
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => getCtx().loaded);
    act(() => getCtx().openWorkspace('/new/project'));
    expect(getCtx().state.workspace).toBe('/new/project');
    expect(getCtx().state.recentWorkspaces).toContain('/new/project');
  });

  it('openWorkspace deduplicates recents', async () => {
    invokeMock.mockResolvedValue({
      version: 1,
      workspace: '/old',
      openTabs: [],
      expandedFolders: [],
      recentWorkspaces: ['/new/project', '/other'],
      window: { x: 0, y: 0, w: 1280, h: 800 },
    });
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => getCtx().loaded);
    act(() => getCtx().openWorkspace('/new/project'));
    const recents = getCtx().state.recentWorkspaces;
    expect(recents.filter((r) => r === '/new/project')).toHaveLength(1);
    expect(recents[0]).toBe('/new/project');
  });

  it('openTab adds tab and sets it active', async () => {
    invokeMock.mockResolvedValue(null);
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => getCtx().loaded);
    act(() => getCtx().openTab('/proj/a.ts'));
    expect(getCtx().state.openTabs).toHaveLength(1);
    expect(getCtx().state.openTabs[0].active).toBe(true);
  });

  it('closeTab removes it and adjusts active', async () => {
    invokeMock.mockResolvedValue(null);
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => getCtx().loaded);
    act(() => { getCtx().openTab('/a.ts'); getCtx().openTab('/b.ts'); });
    act(() => getCtx().closeTab('/b.ts'));
    expect(getCtx().state.openTabs.find((t) => t.path === '/b.ts')).toBeUndefined();
  });

  it('toggleFolder adds and removes from expandedFolders', async () => {
    invokeMock.mockResolvedValue(null);
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => getCtx().loaded);
    act(() => getCtx().toggleFolder('/proj/src'));
    expect(getCtx().state.expandedFolders).toContain('/proj/src');
    act(() => getCtx().toggleFolder('/proj/src'));
    expect(getCtx().state.expandedFolders).not.toContain('/proj/src');
  });

  it('addRecent caps at 10 entries', async () => {
    invokeMock.mockResolvedValue(null);
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => getCtx().loaded);
    act(() => {
      for (let i = 0; i < 12; i++) getCtx().addRecent(`/proj/${i}`);
    });
    expect(getCtx().state.recentWorkspaces.length).toBeLessThanOrEqual(10);
  });

  it('forceSave calls write_ide_state immediately', async () => {
    invokeMock.mockResolvedValue(null);
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => getCtx().loaded);
    await act(() => getCtx().forceSave());
    expect(invokeMock).toHaveBeenCalledWith('write_ide_state', expect.objectContaining({ value: expect.any(Object) }));
  });

  it('setScrollTop updates scrollTop for a tab', async () => {
    invokeMock.mockResolvedValue(null);
    const { wrapper, getCtx } = makeWrapper();
    render(React.createElement(wrapper));
    await waitFor(() => getCtx().loaded);
    act(() => getCtx().openTab('/file.ts', 0));
    act(() => getCtx().setScrollTop('/file.ts', 200));
    expect(getCtx().state.openTabs.find((t) => t.path === '/file.ts')?.scrollTop).toBe(200);
  });
});
