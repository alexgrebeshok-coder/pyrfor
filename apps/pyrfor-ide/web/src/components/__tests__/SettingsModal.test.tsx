import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ─── Mock @tauri-apps/api/core ───────────────────────────────────────────────

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ─── Make window look like Tauri ────────────────────────────────────────────

beforeEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
    writable: true,
  });
  mockInvoke.mockReset();
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
  // Remove fake Tauri internals
  try {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'];
  } catch {
    // ignore
  }
});

import SettingsModal from '../SettingsModal';

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
});
