// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureDeliveryEvidence, parseGitHubRemoteUrl, sanitizeGitRemoteUrl } from './github-delivery-evidence';

const execFileAsync = promisify(execFile);

describe('GitHub delivery evidence', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeGitRepo(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-github-evidence-'));
    tempRoots.push(dir);
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
    await writeFile(path.join(dir, 'README.md'), '# Evidence\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: dir });
    await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: dir });
    await execFileAsync('git', ['remote', 'add', 'origin', 'git@github.com:acme/pyrfor.git'], { cwd: dir });
    return dir;
  }

  it('parses and sanitizes GitHub remotes without leaking credentials', () => {
    expect(parseGitHubRemoteUrl('git@github.com:acme/pyrfor.git')).toEqual({
      owner: 'acme',
      repo: 'pyrfor',
      fullName: 'acme/pyrfor',
    });
    expect(parseGitHubRemoteUrl('https://github.com/acme/pyrfor.git')?.fullName).toBe('acme/pyrfor');
    expect(parseGitHubRemoteUrl('https://secret-token@github.com/acme/pyrfor.git')?.fullName).toBe('acme/pyrfor');
    expect(sanitizeGitRemoteUrl('https://secret-token@github.com/acme/pyrfor.git')).toBe('https://github.com/acme/pyrfor.git');
  });

  it('builds a local-only delivery evidence snapshot when GitHub access is unavailable', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-not-git-'));
    tempRoots.push(dir);

    const snapshot = await captureDeliveryEvidence({
      workspace: dir,
      runId: 'run-1',
      githubToken: 'secret-token',
      fetchImpl: null,
    });

    expect(snapshot.schemaVersion).toBe('pyrfor.delivery_evidence.v1');
    expect(snapshot.git.available).toBe(false);
    expect(snapshot.github.available).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
  });

  it('captures branch pr issue and ci evidence through read-only GitHub APIs', async () => {
    const dir = await makeGitRepo();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/branches/main')) {
        return { ok: true, status: 200, json: async () => ({ name: 'main', protected: true, commit: { sha: 'abc123' } }) };
      }
      if (url.includes('/pulls?')) {
        return { ok: true, status: 200, json: async () => ([{ number: 42, title: 'Ship evidence', state: 'open', html_url: 'https://github.com/acme/pyrfor/pull/42', head: { ref: 'main' }, base: { ref: 'main' } }]) };
      }
      if (url.includes('/actions/runs?')) {
        return { ok: true, status: 200, json: async () => ({ workflow_runs: [{ id: 7, name: 'CI', status: 'completed', conclusion: 'success', html_url: 'https://github.com/acme/pyrfor/actions/runs/7', head_sha: 'abc123' }] }) };
      }
      if (url.includes('/issues/5')) {
        return { ok: true, status: 200, json: async () => ({ number: 5, title: 'Track delivery', state: 'open', html_url: 'https://github.com/acme/pyrfor/issues/5' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const snapshot = await captureDeliveryEvidence({
      workspace: dir,
      runId: 'run-1',
      summary: 'Delivered feature',
      verifierStatus: 'passed',
      deliveryChecklist: ['tests'],
      deliveryArtifactId: 'artifact-delivery',
      issueNumber: 5,
      githubToken: 'secret-token',
      fetchImpl,
    });

    expect(snapshot.git.available).toBe(true);
    expect(snapshot.git.remote?.repository).toBe('acme/pyrfor');
    expect(snapshot.github.repository).toBe('acme/pyrfor');
    expect(snapshot.github.branch).toMatchObject({ name: 'main', protected: true, commitSha: 'abc123' });
    expect(snapshot.github.pullRequests[0]).toMatchObject({ number: 42, state: 'open' });
    expect(snapshot.github.workflowRuns[0]).toMatchObject({ id: 7, conclusion: 'success' });
    expect(snapshot.github.issue).toMatchObject({ number: 5, state: 'open' });
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('does not persist credential-bearing git remote urls in snapshots', async () => {
    const dir = await makeGitRepo();
    await execFileAsync('git', ['remote', 'set-url', 'origin', 'https://secret-token@github.com/acme/pyrfor.git'], { cwd: dir });

    const snapshot = await captureDeliveryEvidence({
      workspace: dir,
      runId: 'run-1',
      fetchImpl: null,
    });

    expect(snapshot.git.remote?.url).toBe('https://github.com/acme/pyrfor.git');
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
  });
});
