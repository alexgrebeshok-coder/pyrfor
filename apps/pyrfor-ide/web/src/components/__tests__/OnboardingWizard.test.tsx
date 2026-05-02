import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockInvoke = vi.fn();
const mockDaemonFetch = vi.fn();

vi.mock('../../components/SettingsModal', () => ({
  DEFAULT_SETTINGS: {
    version: 1,
    theme: 'auto',
    font: 'Menlo',
    fontSize: 13,
    lineHeight: 1.5,
    keybindings: {},
    logLevel: 'info',
  },
  ONBOARDING_PROVIDER_OPTIONS: [
    { id: 'openrouter', label: 'OpenRouter', secretKey: 'provider:openrouter', defaultModel: 'openrouter/auto' },
    { id: 'zai', label: 'ZAI', secretKey: 'provider:zai', defaultModel: 'glm-4.5' },
    { id: 'openai', label: 'OpenAI', secretKey: 'provider:openai', defaultModel: 'gpt-4.1-mini' },
  ],
  isTauriRuntime: () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  tauriInvoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('../../lib/api', () => ({
  syncProviderCredentials: (...args: unknown[]) => mockDaemonFetch(...args),
}));

import OnboardingWizard from '../OnboardingWizard';

describe('OnboardingWizard', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
      writable: true,
    });
    mockInvoke.mockReset();
    mockDaemonFetch.mockReset();
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'detect_system_memory_gb') return 16;
      if (cmd === 'read_pyrfor_config') return null;
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
      if (cmd === 'ollama_pull_model') return { status: 'done' };
      if (cmd === 'test_provider_connection') return undefined;
      if (cmd === 'set_secret') return undefined;
      if (cmd === 'write_pyrfor_config') return undefined;
      if (cmd === 'inject_provider_keys') return {};
      if (cmd === 'write_settings') return undefined;
      return null;
    });
  });

  afterEach(() => {
    try {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    } catch {
      // ignore
    }
  });

  it('shows memory-based local model recommendation and saves onboarding config', async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} onToast={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Local model \/ Ollama/i }));
    fireEvent.click(screen.getByRole('button', { name: /Далее/i }));

    await waitFor(() => {
      expect(screen.getByText(/16 GB/i)).toBeTruthy();
      expect(screen.getByText(/qwen2.5:7b/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Download qwen2.5:7b/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('ollama_pull_model', { model: 'qwen2.5:7b' });
    });

    fireEvent.click(screen.getByRole('button', { name: /Далее/i }));
    fireEvent.click(screen.getByRole('button', { name: /Далее/i }));
    fireEvent.click(screen.getByRole('button', { name: /Завершить/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'write_pyrfor_config',
        expect.objectContaining({
            value: expect.objectContaining({
              ai: expect.objectContaining({
                activeModel: { provider: 'ollama', modelId: 'qwen2.5:7b' },
                localFirst: true,
                localOnly: false,
              }),
              providers: expect.objectContaining({ defaultProvider: 'ollama', enableFallback: true }),
              onboarding: expect.objectContaining({ mode: 'local-model', model: 'qwen2.5:7b' }),
            }),
        })
      );
      expect(mockInvoke).toHaveBeenCalledWith(
        'write_settings',
        expect.objectContaining({
          value: expect.objectContaining({ onboardingComplete: true }),
        })
      );
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'local-model', modelLabel: 'qwen2.5:7b' })
      );
    });
  });

  it('tests cloud provider connection and shows success check', async () => {
    render(<OnboardingWizard onComplete={vi.fn()} onToast={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Cloud')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('Cloud'));
    fireEvent.click(screen.getByRole('button', { name: /Далее/i }));
    fireEvent.click(screen.getByRole('button', { name: /Далее/i }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /OpenRouter/i })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/OpenRouter API key/i), {
      target: { value: 'sk-or-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Test connection/i }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('test_provider_connection', {
        provider: 'openrouter',
        secret: 'sk-or-test',
      });
      expect(mockInvoke).toHaveBeenCalledWith('set_secret', {
        key: 'provider:openrouter',
        value: 'sk-or-test',
      });
      expect(screen.getByText(/Подключение подтверждено/i)).toBeTruthy();
    });
  });
});
