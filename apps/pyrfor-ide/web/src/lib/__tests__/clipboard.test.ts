import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../components/SettingsModal', () => ({
  isTauriRuntime: vi.fn(() => false),
}));

import { copyToClipboard, installClipboardBridge } from '../clipboard';

describe('clipboard', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue('pasted'),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('copyToClipboard writes via navigator in web mode', async () => {
    await copyToClipboard('hello');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
  });

  it('installClipboardBridge pastes into textarea', async () => {
    const cleanup = installClipboardBridge();
    const textarea = document.createElement('textarea');
    textarea.value = 'ab';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(2, 2);

    const event = new Event('paste', { bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(textarea.value).toBe('abpasted');
    });

    cleanup();
    document.body.removeChild(textarea);
  });

  it('installClipboardBridge skips paste when Monaco wrapper is focused', async () => {
    const cleanup = installClipboardBridge();
    const wrapper = document.createElement('div');
    wrapper.className = 'monaco-wrapper';
    const inner = document.createElement('div');
    inner.tabIndex = 0;
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);
    inner.focus();

    const readSpy = vi.spyOn(navigator.clipboard, 'readText');
    document.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }));

    expect(readSpy).not.toHaveBeenCalled();

    cleanup();
    document.body.removeChild(wrapper);
  });
});
