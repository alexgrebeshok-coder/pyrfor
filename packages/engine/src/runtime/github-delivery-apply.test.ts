// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyGithubDeliveryPlan, validateGithubDeliveryApplyPreconditions } from './github-delivery-apply';
import type { ArtifactRef } from './artifact-model';
import type { GitHubDeliveryPlan } from './github-delivery-plan';

const execFileAsync = promisify(execFile);

describe('GitHub delivery apply', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function createWorkspace(): Promise<{ workspace: string; headSha: string }> {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-github-apply-'));
    tempRoots.push(workspace);
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: workspace });
    await execFileAsync('git', ['config', 'user.email', 'pyrfor@example.test'], { cwd: workspace });
    await execFileAsync('git', ['config', 'user.name', 'Pyrfor Test'], { cwd: workspace });
    await writeFile(path.join(workspace, 'README.md'), '# test\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: workspace });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: workspace });
    await execFileAsync('git', ['remote', 'add', 'origin', 'https://github.com/acme/pyrfor.git'], { cwd: workspace });
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspace });
    return { workspace, headSha: stdout.trim() };
  }

  function plan(headSha: string): GitHubDeliveryPlan {
    return {
      schemaVersion: 'pyrfor.github_delivery_plan.v1',
      createdAt: '2026-05-03T00:00:00.000Z',
      runId: 'run-1',
      mode: 'dry_run',
      applySupported: true,
      approvalRequired: true,
      repository: 'acme/pyrfor',
      baseBranch: 'main',
      headSha,
      proposedBranch: `pyrfor/run-1-${headSha.slice(0, 8)}`,
      pullRequest: {
        title: 'Ship feature',
        body: 'Verifier passed.',
        draft: true,
      },
      ci: { observeWorkflowRuns: [] },
      blockers: [],
      evidenceArtifactId: 'artifact-evidence',
      provenance: {
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha,
        evidenceArtifactId: 'artifact-evidence',
      },
    };
  }

  function artifact(): ArtifactRef {
    return {
      id: 'artifact-plan',
      kind: 'delivery_plan',
      uri: '/tmp/artifact-plan.json',
      sha256: 'plan-sha',
      createdAt: '2026-05-03T00:00:00.000Z',
      runId: 'run-1',
    };
  }

  it('creates a draft PR when reviewed branch already exists at the approved HEAD', async () => {
    const { workspace, headSha } = await createWorkspace();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ commit: { sha: headSha } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          number: 12,
          html_url: 'https://github.com/acme/pyrfor/pull/12',
          title: 'Ship feature',
          state: 'open',
          draft: true,
          head: { ref: `pyrfor/run-1-${headSha.slice(0, 8)}` },
          base: { ref: 'main' },
        }),
      });

    const result = await applyGithubDeliveryPlan({
      workspace,
      runId: 'run-1',
      plan: plan(headSha),
      planArtifact: artifact(),
      approvalId: 'approval-1',
      githubToken: 'secret-token',
      fetchImpl,
    });

    expect(result).toMatchObject({
      schemaVersion: 'pyrfor.github_delivery_apply.v1',
      mode: 'draft_pr',
      repository: 'acme/pyrfor',
      branch: `pyrfor/run-1-${headSha.slice(0, 8)}`,
      draftPullRequest: {
        number: 12,
        draft: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
    const firstRequest = fetchImpl.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined;
    expect(firstRequest?.headers?.Authorization).toBe('Bearer secret-token');
  });

  it('rejects dirty workspace drift before any GitHub write', async () => {
    const { workspace, headSha } = await createWorkspace();
    await writeFile(path.join(workspace, 'dirty.txt'), 'dirty\n');
    const fetchImpl = vi.fn();

    await expect(validateGithubDeliveryApplyPreconditions({
      workspace,
      runId: 'run-1',
      plan: plan(headSha),
      planArtifact: artifact(),
      expectedPlanSha256: 'plan-sha',
    })).rejects.toThrow(/dirty file/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not leak tokens in GitHub API errors', async () => {
    const { workspace, headSha } = await createWorkspace();
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'bad credentials secret-token' }),
    });

    await expect(applyGithubDeliveryPlan({
      workspace,
      runId: 'run-1',
      plan: plan(headSha),
      planArtifact: artifact(),
      approvalId: 'approval-1',
      githubToken: 'secret-token',
      fetchImpl,
    })).rejects.toThrow('GitHubDeliveryApply: GitHub API returned 401');
  });
});
