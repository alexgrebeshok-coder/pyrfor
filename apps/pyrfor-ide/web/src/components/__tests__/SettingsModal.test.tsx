import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

// ─── Mock @tauri-apps/api/core ───────────────────────────────────────────────

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ─── Mock ../lib/api (used by ModelsTab) ────────────────────────────────────

const mockListModels = vi.fn();
const mockGetActiveModel = vi.fn();
const mockSetActiveModel = vi.fn();
const mockGetLocalMode = vi.fn();
const mockSetLocalMode = vi.fn();

vi.mock('../../lib/api', () => ({
  listModels: (...args: unknown[]) => mockListModels(...args),
  getActiveModel: (...args: unknown[]) => mockGetActiveModel(...args),
  setActiveModel: (...args: unknown[]) => mockSetActiveModel(...args),
  getLocalMode: (...args: unknown[]) => mockGetLocalMode(...args),
  setLocalMode: (...args: unknown[]) => mockSetLocalMode(...args),
}));

// ─── Make window look like Tauri ────────────────────────────────────────────

beforeEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
    writable: true,
  });
  mockInvoke.mockReset();
  mockListModels.mockReset();
  mockGetActiveModel.mockReset();
  mockSetActiveModel.mockReset();
  mockGetLocalMode.mockReset();
  mockSetLocalMode.mockReset();
  mockListModels.mockResolvedValue([]);
  mockGetActiveModel.mockResolvedValue(null);
  mockSetActiveModel.mockResolvedValue({ ok: true, activeModel: { provider: 'ollama', modelId: 'llama3' } });
  mockGetLocalMode.mockResolvedValue({ localFirst: false, localOnly: false });
  mockSetLocalMode.mockResolvedValue({ ok: true, localFirst: false, localOnly: false });
  // Default: read_settings returns defaults, get_secret returns null
  mockInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'read_settings') {
      return {
        version: 1,
        theme: 'auto',
        font: 'Menlo',
        fontSize: 13,
        lineHeight: 1.5,
        keybindings: {},
        logLevel: 'info',
      };
    }
    if (cmd === 'get_secret') return null;
    if (cmd === 'get_daemon_port') return 18790;
    if (cmd === 'write_settings') return undefined;
    if (cmd === 'set_secret') return undefined;
    if (cmd === 'delete_secret') return undefined;
    return null;
  });
});

afterEach(() => {
  cleanup();
  // Remove fake Tauri internals
  try {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  } catch {
    // ignore
  }
});

import SettingsModal from '../SettingsModal';
import type { ModelEntry } from '../../lib/api';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SettingsModal', () => {
  it('renders with Appearance tab active by default', async () => {
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('tab-btn-appearance')).toBeTruthy();
    });
    // Appearance tab content should be visible
    await waitFor(() => {
      expect(screen.getByTestId('tab-appearance')).toBeTruthy();
    });
  });

  it('switches to Keybindings tab', async () => {
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-keybindings'));
    fireEvent.click(screen.getByTestId('tab-btn-keybindings'));
    await waitFor(() => {
      expect(screen.getByTestId('tab-keybindings')).toBeTruthy();
    });
  });

  it('switches to Provider Keys tab', async () => {
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-provider-keys'));
    fireEvent.click(screen.getByTestId('tab-btn-provider-keys'));
    await waitFor(() => {
      expect(screen.getByTestId('tab-provider-keys')).toBeTruthy();
    });
  });

  it('switches to Daemon tab', async () => {
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-daemon'));
    fireEvent.click(screen.getByTestId('tab-btn-daemon'));
    await waitFor(() => {
      expect(screen.getByTestId('tab-daemon')).toBeTruthy();
    });
  });

  it('saves a provider key and calls set_secret with correct args', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'read_settings') return { version: 1, theme: 'auto', font: 'Menlo', fontSize: 13, lineHeight: 1.5, keybindings: {}, logLevel: 'info' };
      if (cmd === 'get_secret') return null;
      if (cmd === 'get_daemon_port') return 18790;
      if (cmd === 'set_secret') return undefined;
      return null;
    });

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-provider-keys'));
    fireEvent.click(screen.getByTestId('tab-btn-provider-keys'));

    await waitFor(() => screen.getByTestId('tab-provider-keys'));

    const anthropicInput = screen.getByLabelText('anthropic API key');
    fireEvent.change(anthropicInput, { target: { value: 'sk-ant-test-key' } });

    const saveBtn = screen.getByLabelText('Save anthropic key');
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('set_secret', {
        key: 'provider:anthropic',
        value: 'sk-ant-test-key',
      });
    });
  });

  it('calls write_settings with updated theme on Save', async () => {
    render(<SettingsModal onClose={vi.fn()} />);
    await waitFor(() => screen.getByTestId('tab-appearance'));

    const themeSelect = screen.getByRole('combobox');
    fireEvent.change(themeSelect, { target: { value: 'dark' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-save-btn'));
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'write_settings',
        expect.objectContaining({
          value: expect.objectContaining({ theme: 'dark' }),
        })
      );
    });
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    await waitFor(() => screen.getByText('Cancel'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('all four tabs are rendered in the tab list', async () => {
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-appearance'));
    expect(screen.getByTestId('tab-btn-appearance')).toBeTruthy();
    expect(screen.getByTestId('tab-btn-keybindings')).toBeTruthy();
    expect(screen.getByTestId('tab-btn-provider-keys')).toBeTruthy();
    expect(screen.getByTestId('tab-btn-daemon')).toBeTruthy();
  });

  it('renders Models tab button', async () => {
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-models'));
    expect(screen.getByTestId('tab-btn-models')).toBeTruthy();
  });

  it('switches to Models tab and shows loading then empty state', async () => {
    let resolveModels: (v: unknown) => void = () => {};
    const pending = new Promise<unknown>((r) => { resolveModels = r; });
    mockListModels.mockImplementationOnce(() => pending as Promise<ModelEntry[]>);
    mockGetActiveModel.mockResolvedValue(null);

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-models'));
    fireEvent.click(screen.getByTestId('tab-btn-models'));
    expect(screen.getByText(/Loading models/i)).toBeTruthy();

    resolveModels([]);

    await waitFor(() => {
      expect(screen.getByTestId('tab-models')).toBeTruthy();
      expect(screen.queryByText(/Loading models/i)).toBeNull();
    });
  });

  it('shows grouped models and allows selection', async () => {
    const modelsList = [
      { provider: 'ollama', id: 'llama3', label: 'llama3', available: true },
      { provider: 'mlx', id: 'phi-3', label: 'phi-3', available: true },
    ];
    mockListModels.mockResolvedValue(modelsList);
    mockGetActiveModel.mockResolvedValue(null);

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-models'));
    fireEvent.click(screen.getByTestId('tab-btn-models'));

    await waitFor(() => {
      expect(screen.getByTestId('model-select-ollama-llama3')).toBeTruthy();
      expect(screen.getByTestId('model-select-mlx-phi-3')).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('model-select-ollama-llama3'));

    await waitFor(() => {
      expect(mockSetActiveModel).toHaveBeenCalledWith('ollama', 'llama3');
    });
  });

  // ── Local-first / local-only toggles ─────────────────────────────────────

  it('renders local-first and local-only toggles in Models tab', async () => {
    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-models'));
    fireEvent.click(screen.getByTestId('tab-btn-models'));

    await waitFor(() => {
      expect(screen.getByTestId('local-first-toggle')).toBeTruthy();
      expect(screen.getByTestId('local-only-toggle')).toBeTruthy();
    });
  });

  it('local-only toggle is disabled when local-first is off', async () => {
    mockGetLocalMode.mockResolvedValue({ localFirst: false, localOnly: false });

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-models'));
    fireEvent.click(screen.getByTestId('tab-btn-models'));

    await waitFor(() => screen.getByTestId('local-only-toggle'));
    const localOnlyToggle = screen.getByTestId('local-only-toggle') as HTMLInputElement;
    expect(localOnlyToggle.disabled).toBe(true);
  });

  it('local-only toggle is enabled when local-first is on', async () => {
    mockGetLocalMode.mockResolvedValue({ localFirst: true, localOnly: false });

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-models'));
    fireEvent.click(screen.getByTestId('tab-btn-models'));

    await waitFor(() => screen.getByTestId('local-only-toggle'));
    const localOnlyToggle = screen.getByTestId('local-only-toggle') as HTMLInputElement;
    expect(localOnlyToggle.disabled).toBe(false);
  });

  it('clicking local-first calls setLocalMode API', async () => {
    mockGetLocalMode.mockResolvedValue({ localFirst: false, localOnly: false });
    mockSetLocalMode.mockResolvedValue({ ok: true, localFirst: true, localOnly: false });

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-models'));
    fireEvent.click(screen.getByTestId('tab-btn-models'));

    await waitFor(() => screen.getByTestId('local-first-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('local-first-toggle'));
    });

    await waitFor(() => {
      expect(mockSetLocalMode).toHaveBeenCalledWith({ localFirst: true, localOnly: false });
    });
  });

  it('enabling local-only also enables local-first', async () => {
    mockGetLocalMode.mockResolvedValue({ localFirst: true, localOnly: false });
    mockSetLocalMode.mockResolvedValue({ ok: true, localFirst: true, localOnly: true });

    render(<SettingsModal onClose={() => {}} />);
    await waitFor(() => screen.getByTestId('tab-btn-models'));
    fireEvent.click(screen.getByTestId('tab-btn-models'));

    await waitFor(() => screen.getByTestId('local-only-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('local-only-toggle'));
    });

    await waitFor(() => {
      expect(mockSetLocalMode).toHaveBeenCalledWith({ localFirst: true, localOnly: true });
    });
  });
});
