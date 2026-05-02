// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { buildGithubDeliveryPlan } from './github-delivery-plan';
import type { DeliveryEvidenceSnapshot } from './github-delivery-evidence';
import type { RunRecord } from './run-lifecycle';

const run = {
  run_id: 'run-1',
  task_id: 'Build Delivery Evidence',
  goal: 'Build delivery evidence flow',
  mode: 'pm',
  status: 'completed',
  artifact_refs: [],
  created_at: '2026-05-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:05:00.000Z',
} as RunRecord;

const evidence: DeliveryEvidenceSnapshot = {
  schemaVersion: 'pyrfor.delivery_evidence.v1',
  capturedAt: '2026-05-01T00:06:00.000Z',
  runId: 'run-1',
  summary: 'Delivered evidence flow',
  verifierStatus: 'passed',
  deliveryChecklist: ['tests', 'release notes'],
  deliveryArtifactId: 'artifact-delivery',
  git: {
    available: true,
    branch: 'main',
    headSha: 'abcdef1234567890',
    ahead: 0,
    behind: 0,
    dirtyFiles: [],
    latestCommits: [],
    remote: { name: 'origin', url: 'https://github.com/acme/pyrfor.git', repository: 'acme/pyrfor' },
  },
  github: {
    provider: 'github',
    available: true,
    repository: 'acme/pyrfor',
    branch: { name: 'main', commitSha: 'base000000000000' },
    pullRequests: [],
    workflowRuns: [{ id: 7, name: 'CI', status: 'completed', conclusion: 'success', url: 'https://github.com/acme/pyrfor/actions/runs/7' }],
    issue: { number: 5, title: 'Track delivery', state: 'open', url: 'https://github.com/acme/pyrfor/issues/5' },
    errors: [],
  },
};

describe('GitHub delivery plan', () => {
  it('builds a dry-run plan without enabling remote writes', () => {
    const plan = buildGithubDeliveryPlan({
      run,
      evidence,
      evidenceArtifactId: 'artifact-evidence',
      applySupported: true,
    });

    expect(plan).toMatchObject({
      schemaVersion: 'pyrfor.github_delivery_plan.v1',
      mode: 'dry_run',
      applySupported: true,
      approvalRequired: true,
      repository: 'acme/pyrfor',
      baseBranch: 'main',
      headSha: 'abcdef1234567890',
      issue: { number: 5 },
      evidenceArtifactId: 'artifact-evidence',
      provenance: expect.objectContaining({
        repository: 'acme/pyrfor',
        baseBranch: 'main',
        headSha: 'abcdef1234567890',
        evidenceArtifactId: 'artifact-evidence',
      }),
    });
    expect(plan.proposedBranch).toMatch(/^pyrfor\/build-delivery-evidence-/);
    expect(plan.pullRequest.body).toContain('No GitHub writes were performed');
    expect(plan.ci.observeWorkflowRuns[0]).toMatchObject({ id: 7, conclusion: 'success' });
    expect(plan.blockers).toEqual([]);
  });

  it('reports blockers for unsafe or incomplete delivery state', () => {
    const plan = buildGithubDeliveryPlan({
      run,
      evidence: {
        ...evidence,
        verifierStatus: 'blocked',
        git: {
          ...evidence.git,
          branch: 'HEAD',
          headSha: null,
          dirtyFiles: [{ path: 'src/app.ts', x: 'M', y: '.' }],
        },
        github: {
          ...evidence.github,
          repository: null,
          errors: [{ scope: 'branch', status: 404, message: 'GitHub API returned 404' }],
        },
      },
    });

    expect(plan.blockers).toEqual(expect.arrayContaining([
      'verifier status is blocked',
      'base branch is unavailable',
      'HEAD sha is unavailable',
      'workspace has 1 dirty file(s)',
      'GitHub branch: GitHub API returned 404',
    ]));
  });

  it('keeps apply unsupported when apply blockers are present', () => {
    const plan = buildGithubDeliveryPlan({
      run,
      evidence,
      applySupported: true,
      applyBlockers: ['GitHub token is unavailable for apply'],
    });

    expect(plan.applySupported).toBe(false);
    expect(plan.blockers).toContain('GitHub token is unavailable for apply');
  });

  it('blocks empty draft PR plans when base branch already points at HEAD', () => {
    const plan = buildGithubDeliveryPlan({
      run,
      evidence: {
        ...evidence,
        github: {
          ...evidence.github,
          branch: { name: 'main', commitSha: evidence.git.headSha ?? undefined },
        },
      },
      applySupported: true,
    });

    expect(plan.applySupported).toBe(false);
    expect(plan.blockers).toContain('proposed draft PR would be empty because base branch already points at HEAD');
  });
});
