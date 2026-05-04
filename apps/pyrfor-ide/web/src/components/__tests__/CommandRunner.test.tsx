import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CommandRunner from '../CommandRunner';

const mockExec = vi.fn();

vi.mock('../../lib/api', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

function renderRunner() {
  return render(
    <CommandRunner
      cwd="/Users/alice/private-workspace"
      collapsed={false}
      onToggle={vi.fn()}
      onToast={vi.fn()}
    />,
  );
}

describe('CommandRunner', () => {
  beforeEach(() => {
    localStorage.clear();
    mockExec.mockReset();
    mockExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 12 });
  });

  it('does not persist sensitive commands to localStorage', async () => {
    renderRunner();

    const input = screen.getByPlaceholderText(/npm test/i);
    fireEvent.change(input, {
      target: { value: 'curl -H "Authorization: Bearer secret-token" /Users/alice/private.txt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(mockExec).toHaveBeenCalledWith(
        'curl -H "Authorization: Bearer secret-token" /Users/alice/private.txt',
        '/Users/alice/private-workspace',
      );
    });
    expect(localStorage.getItem('pyrfor-cmd-history')).toBeNull();
  });

  it('keeps command history only in memory for the current component session', async () => {
    renderRunner();

    const input = screen.getByPlaceholderText(/npm test/i) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'pnpm test' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(mockExec).toHaveBeenCalledWith('pnpm test', '/Users/alice/private-workspace'));

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(input.value).toBe('pnpm test');
    expect(localStorage.getItem('pyrfor-cmd-history')).toBeNull();
  });

  it('clears and ignores legacy persisted command history', async () => {
    localStorage.setItem(
      'pyrfor-cmd-history',
      JSON.stringify(['cat /Users/alice/.ssh/id_rsa && echo ghp_legacysecret']),
    );

    renderRunner();

    await waitFor(() => expect(localStorage.getItem('pyrfor-cmd-history')).toBeNull());

    const input = screen.getByPlaceholderText(/npm test/i) as HTMLTextAreaElement;
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(input.value).toBe('');
    expect(document.body.textContent || '').not.toContain('ghp_legacysecret');
    expect(document.body.textContent || '').not.toContain('/Users/alice/.ssh');
  });
});
