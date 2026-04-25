import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GitPanel from '../GitPanel';

// ─── Mock api module ────────────────────────────────────────────────────────

vi.mock('../../lib/api', () => ({
  gitGetStatus: vi.fn(),
  gitStageFiles: vi.fn(),
  gitUnstageFiles: vi.fn(),
  gitCommitFiles: vi.fn(),
}));

import { gitGetStatus, gitStageFiles, gitUnstageFiles, gitCommitFiles } from '../../lib/api';

const mockGetStatus = vi.mocked(gitGetStatus);
const mockStageFiles = vi.mocked(gitStageFiles);
const mockUnstageFiles = vi.mocked(gitUnstageFiles);
const mockCommitFiles = vi.mocked(gitCommitFiles);

const WORKSPACE = '/fake/workspace';

beforeEach(() => {
  vi.clearAllMocks();
  mockStageFiles.mockResolvedValue({ ok: true });
  mockUnstageFiles.mockResolvedValue({ ok: true });
  mockCommitFiles.mockResolvedValue({ sha: 'abc1234' });
});

describe('GitPanel', () => {
  it('renders hint when no workspace', () => {
    render(<GitPanel workspace="" />);
    expect(screen.getByText(/Open a folder to use Git/i)).toBeTruthy();
  });

  it('shows "No changes" on clean repo', async () => {
    mockGetStatus.mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, files: [] });
    render(<GitPanel workspace={WORKSPACE} />);
    await waitFor(() => expect(screen.getByText(/No changes/i)).toBeTruthy());
  });

  it('renders staged files in Staged section', async () => {
    mockGetStatus.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [
        { path: 'src/index.ts', x: 'A', y: '.' },
        { path: 'src/utils.ts', x: 'M', y: '.' },
      ],
    });
    render(<GitPanel workspace={WORKSPACE} />);
    await waitFor(() => {
      expect(screen.getByText(/Staged/i)).toBeTruthy();
      expect(screen.getByText('src/index.ts')).toBeTruthy();
      expect(screen.getByText('src/utils.ts')).toBeTruthy();
    });
  });

  it('renders untracked files in Changes section', async () => {
    mockGetStatus.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ path: 'new-file.ts', x: '?', y: '?' }],
    });
    render(<GitPanel workspace={WORKSPACE} />);
    await waitFor(() => {
      expect(screen.getByText(/Changes/i)).toBeTruthy();
      expect(screen.getByText('new-file.ts')).toBeTruthy();
    });
  });

  it('calls gitStageFiles when unchecked checkbox is checked', async () => {
    mockGetStatus.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ path: 'unstaged.ts', x: '.', y: 'M' }],
    });
    render(<GitPanel workspace={WORKSPACE} />);
    await waitFor(() => screen.getByText('unstaged.ts'));

    const checkboxes = screen.getAllByRole('checkbox');
    const unchecked = checkboxes.find((cb) => !(cb as HTMLInputElement).checked);
    expect(unchecked).toBeTruthy();
    // Use click to toggle checkbox — works correctly with React controlled components
    fireEvent.click(unchecked!);
    await waitFor(() =>
      expect(mockStageFiles).toHaveBeenCalledWith(WORKSPACE, ['unstaged.ts']),
    );
  });

  it('calls gitUnstageFiles when checked checkbox is unchecked', async () => {
    mockGetStatus.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ path: 'staged.ts', x: 'A', y: '.' }],
    });
    render(<GitPanel workspace={WORKSPACE} />);
    await waitFor(() => screen.getByText('staged.ts'));

    const checkboxes = screen.getAllByRole('checkbox');
    const checked = checkboxes.find((cb) => (cb as HTMLInputElement).checked);
    expect(checked).toBeTruthy();
    // Use click to uncheck — works correctly with React controlled components
    fireEvent.click(checked!);
    await waitFor(() =>
      expect(mockUnstageFiles).toHaveBeenCalledWith(WORKSPACE, ['staged.ts']),
    );
  });

  it('calls onViewDiff when file name is clicked', async () => {
    const onViewDiff = vi.fn();
    mockGetStatus.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ path: 'view-me.ts', x: '?', y: '?' }],
    });
    render(<GitPanel workspace={WORKSPACE} onViewDiff={onViewDiff} />);
    await waitFor(() => screen.getByText('view-me.ts'));
    fireEvent.click(screen.getByText('view-me.ts'));
    expect(onViewDiff).toHaveBeenCalledWith('view-me.ts', false);
  });

  it('calls gitCommitFiles when commit button is clicked', async () => {
    mockGetStatus.mockResolvedValue({
      branch: 'main',
      ahead: 0,
      behind: 0,
      files: [{ path: 'staged.ts', x: 'A', y: '.' }],
    });
    render(<GitPanel workspace={WORKSPACE} />);
    await waitFor(() => screen.getByText('staged.ts'));

    const textarea = screen.getByPlaceholderText(/Commit message/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'my commit' } });

    const commitBtn = screen.getByRole('button', { name: /Commit/i });
    fireEvent.click(commitBtn);

    await waitFor(() =>
      expect(mockCommitFiles).toHaveBeenCalledWith(WORKSPACE, 'my commit'),
    );
  });

  it('commit button is disabled when message is empty', async () => {
    mockGetStatus.mockResolvedValue({ branch: 'main', ahead: 0, behind: 0, files: [] });
    render(<GitPanel workspace={WORKSPACE} />);
    await waitFor(() => screen.getByText(/No changes/i));
    const commitBtn = screen.getByRole('button', { name: /Commit/i }) as HTMLButtonElement;
    expect(commitBtn.disabled).toBe(true);
    expect(mockCommitFiles).not.toHaveBeenCalled();
  });
});
