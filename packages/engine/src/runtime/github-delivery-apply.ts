import { gitHeadSha, gitPushHeadToBranch, gitRemote, gitStatus } from './git/api';
import { parseGitHubRemoteUrl } from './github-delivery-evidence';
import type { GitHubDeliveryPlan } from './github-delivery-plan';
import type { ArtifactRef } from './artifact-model';
import type { ApprovalRequest } from './approval-flow';

type FetchLike = (input: string | URL, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface GitHubDeliveryApplyRequest {
  planArtifactId: string;
  expectedPlanSha256: string;
  approvalId?: string;
}

export interface GitHubDeliveryApplyPending {
  status: 'awaiting_approval';
  approval: ApprovalRequest;
  planArtifactId: string;
  expectedPlanSha256: string;
}

export interface GitHubDraftPullRequestResult {
  number: number;
  url: string;
  title: string;
  state: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
}

export interface GitHubDeliveryApplyResult {
  schemaVersion: 'pyrfor.github_delivery_apply.v1';
  appliedAt: string;
  mode: 'draft_pr';
  runId: string;
  repository: string;
  baseBranch: string;
  branch: string;
  headSha: string;
  planArtifactId: string;
  planSha256: string;
  evidenceArtifactId?: string;
  approvalId: string;
  idempotencyKey: string;
  draftPullRequest: GitHubDraftPullRequestResult;
}

export interface GitHubDeliveryApplyApplied {
  status: 'applied';
  artifact: ArtifactRef;
  result: GitHubDeliveryApplyResult;
}

export type GitHubDeliveryApplyResponse = GitHubDeliveryApplyPending | GitHubDeliveryApplyApplied;

export interface GithubDeliveryApplyOptions {
  workspace: string;
  runId: string;
  plan: GitHubDeliveryPlan;
  planArtifact: ArtifactRef;
  approvalId: string;
  githubToken: string;
  remoteName?: string;
  fetchImpl?: FetchLike;
}

export async function validateGithubDeliveryApplyPreconditions(options: {
  workspace: string;
  runId: string;
  plan: GitHubDeliveryPlan;
  planArtifact: ArtifactRef;
  expectedPlanSha256: string;
}): Promise<void> {
  const { workspace, runId, plan, planArtifact, expectedPlanSha256 } = options;
  if (plan.runId !== runId) throw new Error(`GitHubDeliveryApply: plan does not belong to run ${runId}`);
  if (!planArtifact.sha256 || planArtifact.sha256 !== expectedPlanSha256) {
    throw new Error('GitHubDeliveryApply: plan artifact sha mismatch');
  }
  if (!plan.applySupported) throw new Error('GitHubDeliveryApply: plan does not support apply');
  if (plan.blockers.length > 0) {
    throw new Error(`GitHubDeliveryApply: plan has blockers: ${plan.blockers.join('; ')}`);
  }
  if (!plan.repository || !plan.baseBranch || !plan.headSha) {
    throw new Error('GitHubDeliveryApply: plan is missing repository, base branch, or head sha');
  }
  if (plan.provenance.repository !== plan.repository
    || plan.provenance.baseBranch !== plan.baseBranch
    || plan.provenance.headSha !== plan.headSha) {
    throw new Error('GitHubDeliveryApply: plan provenance does not match reviewed delivery fields');
  }

  const [status, headSha, remote] = await Promise.all([
    gitStatus(workspace),
    gitHeadSha(workspace),
    gitRemote(workspace),
  ]);
  if (status.files.length > 0) {
    throw new Error(`GitHubDeliveryApply: workspace has ${status.files.length} dirty file(s)`);
  }
  if (status.branch !== plan.baseBranch) {
    throw new Error(`GitHubDeliveryApply: current branch ${status.branch} does not match reviewed base ${plan.baseBranch}`);
  }
  if (headSha !== plan.headSha) {
    throw new Error('GitHubDeliveryApply: workspace HEAD changed since plan review');
  }
  const remoteRepo = parseGitHubRemoteUrl(remote?.url);
  if (!remoteRepo || remoteRepo.fullName !== plan.repository) {
    throw new Error('GitHubDeliveryApply: workspace remote does not match reviewed repository');
  }
}

export async function applyGithubDeliveryPlan(options: GithubDeliveryApplyOptions): Promise<GitHubDeliveryApplyResult> {
  const { workspace, runId, plan, planArtifact, approvalId, githubToken } = options;
  const repository = parseRepository(plan.repository);
  const baseBranch = requirePlanString(plan.baseBranch, 'base branch');
  const headSha = requirePlanString(plan.headSha, 'head sha');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('GitHubDeliveryApply: fetch is unavailable');
  if (!githubToken) throw new Error('GitHubDeliveryApply: GitHub token is unavailable');
  await validateGithubDeliveryApplyPreconditions({
    workspace,
    runId,
    plan,
    planArtifact,
    expectedPlanSha256: planArtifact.sha256 ?? '',
  });

  const existingBranchSha = await getRemoteBranchSha(fetchImpl, githubToken, repository.owner, repository.repo, plan.proposedBranch);
  if (existingBranchSha && existingBranchSha !== headSha) {
    throw new Error('GitHubDeliveryApply: remote delivery branch points at a different commit');
  }
  if (!existingBranchSha) {
    await gitPushHeadToBranch(workspace, options.remoteName ?? 'origin', plan.proposedBranch);
  }

  const existingPr = await findExistingDraftPr(fetchImpl, githubToken, {
    owner: repository.owner,
    repo: repository.repo,
    headOwner: repository.owner,
    branch: plan.proposedBranch,
    base: baseBranch,
  });
  const draftPullRequest = existingPr ?? await createDraftPullRequest(fetchImpl, githubToken, {
    owner: repository.owner,
    repo: repository.repo,
    title: plan.pullRequest.title,
    body: plan.pullRequest.body,
    head: plan.proposedBranch,
    base: baseBranch,
  });

  return {
    schemaVersion: 'pyrfor.github_delivery_apply.v1',
    appliedAt: new Date().toISOString(),
    mode: 'draft_pr',
    runId,
    repository: plan.repository!,
    baseBranch,
    branch: plan.proposedBranch,
    headSha,
    planArtifactId: planArtifact.id,
    planSha256: planArtifact.sha256!,
    ...(plan.evidenceArtifactId ? { evidenceArtifactId: plan.evidenceArtifactId } : {}),
    approvalId,
    idempotencyKey: buildApplyIdempotencyKey(runId, planArtifact, plan),
    draftPullRequest,
  };
}

export function buildApplyIdempotencyKey(runId: string, planArtifact: ArtifactRef, plan: GitHubDeliveryPlan): string {
  return [
    runId,
    planArtifact.id,
    planArtifact.sha256 ?? 'no-sha',
    plan.proposedBranch,
    plan.headSha ?? 'no-head',
  ].join(':');
}

async function getRemoteBranchSha(
  fetchImpl: FetchLike,
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  const res = await githubRequest(fetchImpl, token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`, {
    method: 'GET',
    allow404: true,
  });
  if (!isRecord(res)) return null;
  const commit = isRecord(res['commit']) ? res['commit'] : null;
  return typeof commit?.['sha'] === 'string' ? commit.sha : null;
}

async function findExistingDraftPr(
  fetchImpl: FetchLike,
  token: string,
  input: { owner: string; repo: string; headOwner: string; branch: string; base: string },
): Promise<GitHubDraftPullRequestResult | null> {
  const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?head=${encodeURIComponent(`${input.headOwner}:${input.branch}`)}&base=${encodeURIComponent(input.base)}&state=open&per_page=5`;
  const raw = await githubRequest(fetchImpl, token, path, { method: 'GET' });
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    const pr = normalizePullRequest(item);
    if (pr && pr.draft) return pr;
  }
  return null;
}

async function createDraftPullRequest(
  fetchImpl: FetchLike,
  token: string,
  input: { owner: string; repo: string; title: string; body: string; head: string; base: string },
): Promise<GitHubDraftPullRequestResult> {
  const raw = await githubRequest(fetchImpl, token, `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      draft: true,
    }),
  });
  const pr = normalizePullRequest(raw);
  if (!pr) throw new Error('GitHubDeliveryApply: GitHub returned an invalid pull request response');
  return pr;
}

async function githubRequest(
  fetchImpl: FetchLike,
  token: string,
  path: string,
  options: { method: 'GET' | 'POST'; body?: string; allow404?: boolean },
): Promise<unknown | null> {
  const res = await fetchImpl(new URL(path, 'https://api.github.com').toString(), {
    method: options.method,
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
    },
    ...(options.body ? { body: options.body } : {}),
  });
  if (options.allow404 && res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHubDeliveryApply: GitHub API returned ${res.status}`);
  return await res.json();
}

function parseRepository(repository: string | null): { owner: string; repo: string } {
  const [owner, repo] = repository?.split('/') ?? [];
  if (!owner || !repo) throw new Error('GitHubDeliveryApply: invalid GitHub repository');
  return { owner, repo };
}

function requirePlanString(value: string | null, field: string): string {
  if (!value) throw new Error(`GitHubDeliveryApply: plan is missing ${field}`);
  return value;
}

function normalizePullRequest(raw: unknown): GitHubDraftPullRequestResult | null {
  if (!isRecord(raw) || typeof raw['number'] !== 'number' || typeof raw['html_url'] !== 'string') return null;
  const head = isRecord(raw['head']) ? raw['head'] : null;
  const base = isRecord(raw['base']) ? raw['base'] : null;
  return {
    number: raw['number'],
    url: raw['html_url'],
    title: typeof raw['title'] === 'string' ? raw['title'] : `PR #${raw['number']}`,
    state: typeof raw['state'] === 'string' ? raw['state'] : 'open',
    draft: raw['draft'] === true,
    headRef: typeof head?.['ref'] === 'string' ? head.ref : '',
    baseRef: typeof base?.['ref'] === 'string' ? base.ref : '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
