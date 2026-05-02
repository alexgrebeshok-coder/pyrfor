import { gitHeadSha, gitLog, gitRemote, gitStatus, type GitLogEntry } from './git/api';

type FetchLike = (input: string | URL, init?: {
  method?: string;
  headers?: Record<string, string>;
}) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  fullName: string;
}

export interface DeliveryEvidenceGitSnapshot {
  available: boolean;
  branch: string | null;
  headSha: string | null;
  ahead: number;
  behind: number;
  dirtyFiles: Array<{ path: string; x: string; y: string }>;
  latestCommits: GitLogEntry[];
  remote?: {
    name: string;
    url: string;
    repository?: string;
  } | null;
  error?: string;
}

export interface GitHubPullRequestEvidence {
  number: number;
  title?: string;
  state: 'open' | 'closed' | 'merged';
  url: string;
  headRef?: string;
  baseRef?: string;
}

export interface GitHubBranchEvidence {
  name: string;
  protected?: boolean;
  commitSha?: string;
  url?: string;
}

export interface GitHubWorkflowRunEvidence {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  url?: string;
  headSha?: string;
}

export interface GitHubIssueEvidence {
  number: number;
  title?: string;
  state?: string;
  url?: string;
}

export interface GitHubDeliveryEvidence {
  provider: 'github';
  available: boolean;
  repository: string | null;
  branch: GitHubBranchEvidence | null;
  pullRequests: GitHubPullRequestEvidence[];
  workflowRuns: GitHubWorkflowRunEvidence[];
  issue?: GitHubIssueEvidence | null;
  errors: Array<{ scope: string; status?: number; message: string }>;
}

export interface DeliveryEvidenceSnapshot {
  schemaVersion: 'pyrfor.delivery_evidence.v1';
  capturedAt: string;
  runId: string;
  summary?: string;
  verifierStatus?: string;
  deliveryChecklist: string[];
  deliveryArtifactId?: string;
  git: DeliveryEvidenceGitSnapshot;
  github: GitHubDeliveryEvidence;
}

export interface CaptureDeliveryEvidenceOptions {
  workspace: string;
  runId: string;
  summary?: string;
  verifierStatus?: string;
  deliveryChecklist?: string[];
  deliveryArtifactId?: string;
  issueNumber?: number;
  githubToken?: string;
  fetchImpl?: FetchLike | null;
}

export function parseGitHubRemoteUrl(remoteUrl: string | undefined | null): GitHubRepositoryRef | null {
  if (!remoteUrl) return null;
  const trimmed = remoteUrl.trim();
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^http:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const owner = match[1]!;
    const repo = match[2]!.replace(/\.git$/, '');
    return { owner, repo, fullName: `${owner}/${repo}` };
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname !== 'github.com') return null;
    const [owner, repo] = url.pathname.replace(/^\//, '').split('/');
    if (!owner || !repo) return null;
    const cleanRepo = repo.replace(/\.git$/, '');
    return { owner, repo: cleanRepo, fullName: `${owner}/${cleanRepo}` };
  } catch {
    // Fall through to unsupported remote syntax.
  }
  return null;
}

export function sanitizeGitRemoteUrl(remoteUrl: string): string {
  try {
    const url = new URL(remoteUrl);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return remoteUrl;
  }
}

export async function captureDeliveryEvidence(
  options: CaptureDeliveryEvidenceOptions,
): Promise<DeliveryEvidenceSnapshot> {
  const git = await captureLocalGitEvidence(options.workspace);
  const repository = parseGitHubRemoteUrl(git.remote?.url);
  const github = await captureGitHubEvidence({
    repository,
    branchName: git.branch,
    headSha: git.headSha,
    issueNumber: options.issueNumber,
    githubToken: options.githubToken,
    fetchImpl: options.fetchImpl,
  });

  return {
    schemaVersion: 'pyrfor.delivery_evidence.v1',
    capturedAt: new Date().toISOString(),
    runId: options.runId,
    ...(options.summary ? { summary: options.summary } : {}),
    ...(options.verifierStatus ? { verifierStatus: options.verifierStatus } : {}),
    deliveryChecklist: options.deliveryChecklist ?? [],
    ...(options.deliveryArtifactId ? { deliveryArtifactId: options.deliveryArtifactId } : {}),
    git,
    github,
  };
}

async function captureLocalGitEvidence(workspace: string): Promise<DeliveryEvidenceGitSnapshot> {
  try {
    const [status, headSha, remote, latestCommits] = await Promise.all([
      gitStatus(workspace),
      gitHeadSha(workspace),
      gitRemote(workspace),
      gitLog(workspace, 5),
    ]);
    const sanitizedRemoteUrl = remote ? sanitizeGitRemoteUrl(remote.url) : null;
    const repository = parseGitHubRemoteUrl(remote?.url);
    return {
      available: true,
      branch: status.branch,
      headSha,
      ahead: status.ahead,
      behind: status.behind,
      dirtyFiles: status.files.slice(0, 100),
      latestCommits,
      remote: remote && sanitizedRemoteUrl ? {
        name: remote.name,
        url: sanitizedRemoteUrl,
        ...(repository ? { repository: repository.fullName } : {}),
      } : null,
    };
  } catch (err) {
    return {
      available: false,
      branch: null,
      headSha: null,
      ahead: 0,
      behind: 0,
      dirtyFiles: [],
      latestCommits: [],
      remote: null,
      error: err instanceof Error ? err.message : 'git evidence unavailable',
    };
  }
}

async function captureGitHubEvidence(input: {
  repository: GitHubRepositoryRef | null;
  branchName: string | null;
  headSha: string | null;
  issueNumber?: number;
  githubToken?: string;
  fetchImpl?: FetchLike | null;
}): Promise<GitHubDeliveryEvidence> {
  const base: GitHubDeliveryEvidence = {
    provider: 'github',
    available: false,
    repository: input.repository?.fullName ?? null,
    branch: null,
    pullRequests: [],
    workflowRuns: [],
    ...(input.issueNumber ? { issue: null } : {}),
    errors: [],
  };
  const fetchImpl = input.fetchImpl === undefined ? globalThis.fetch : input.fetchImpl;
  if (!input.repository || !input.branchName || input.branchName === 'HEAD' || typeof fetchImpl !== 'function') {
    return base;
  }

  const request = async <T>(scope: string, path: string): Promise<T | null> => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (input.githubToken) headers['Authorization'] = `Bearer ${input.githubToken}`;
    try {
      const res = await fetchImpl(new URL(path, 'https://api.github.com').toString(), { headers });
      if (!res.ok) {
        base.errors.push({ scope, status: res.status, message: `GitHub API returned ${res.status}` });
        return null;
      }
      return await res.json() as T;
    } catch (err) {
      base.errors.push({ scope, message: err instanceof Error ? err.message : 'GitHub API request failed' });
      return null;
    }
  };

  const { owner, repo } = input.repository;
  const branchPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(input.branchName)}`;
  const prPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(`${owner}:${input.branchName}`)}&state=all&per_page=5`;
  const workflowPath = input.headSha
    ? `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?head_sha=${encodeURIComponent(input.headSha)}&per_page=5`
    : null;
  const issuePath = input.issueNumber
    ? `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${input.issueNumber}`
    : null;

  const [branch, pulls, workflowRuns, issue] = await Promise.all([
    request<Record<string, unknown>>('branch', branchPath),
    request<unknown[]>('pull_requests', prPath),
    workflowPath ? request<{ workflow_runs?: unknown[] }>('workflow_runs', workflowPath) : Promise.resolve(null),
    issuePath ? request<Record<string, unknown>>('issue', issuePath) : Promise.resolve(null),
  ]);

  base.branch = normalizeBranch(input.branchName, branch);
  base.pullRequests = Array.isArray(pulls) ? pulls.map(normalizePullRequest).filter(isDefined) : [];
  base.workflowRuns = Array.isArray(workflowRuns?.workflow_runs)
    ? workflowRuns.workflow_runs.map(normalizeWorkflowRun).filter(isDefined)
    : [];
  base.issue = issue ? normalizeIssue(issue) : base.issue;
  base.available = Boolean(branch || pulls || workflowRuns || issue);
  return base;
}

function normalizeBranch(branchName: string, branch: Record<string, unknown> | null): GitHubBranchEvidence {
  const commit = isRecord(branch?.['commit']) ? branch['commit'] : null;
  return {
    name: branchName,
    protected: typeof branch?.['protected'] === 'boolean' ? branch['protected'] : undefined,
    commitSha: typeof commit?.['sha'] === 'string' ? commit.sha : undefined,
    url: typeof branch?.['_links'] === 'object' && branch?.['_links'] !== null
      && typeof (branch['_links'] as Record<string, unknown>)['html'] === 'string'
      ? String((branch['_links'] as Record<string, unknown>)['html'])
      : undefined,
  };
}

function normalizePullRequest(raw: unknown): GitHubPullRequestEvidence | null {
  if (!isRecord(raw) || typeof raw['number'] !== 'number' || typeof raw['html_url'] !== 'string') return null;
  const mergedAt = typeof raw['merged_at'] === 'string' && raw['merged_at'].length > 0;
  const head = isRecord(raw['head']) ? raw['head'] : null;
  const base = isRecord(raw['base']) ? raw['base'] : null;
  return {
    number: raw['number'],
    title: typeof raw['title'] === 'string' ? raw['title'] : undefined,
    state: mergedAt ? 'merged' : raw['state'] === 'closed' ? 'closed' : 'open',
    url: raw['html_url'],
    headRef: typeof head?.['ref'] === 'string' ? head.ref : undefined,
    baseRef: typeof base?.['ref'] === 'string' ? base.ref : undefined,
  };
}

function normalizeWorkflowRun(raw: unknown): GitHubWorkflowRunEvidence | null {
  if (!isRecord(raw) || typeof raw['id'] !== 'number') return null;
  return {
    id: raw['id'],
    name: typeof raw['name'] === 'string' ? raw['name'] : undefined,
    status: typeof raw['status'] === 'string' ? raw['status'] : undefined,
    conclusion: typeof raw['conclusion'] === 'string' ? raw['conclusion'] : null,
    url: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
    headSha: typeof raw['head_sha'] === 'string' ? raw['head_sha'] : undefined,
  };
}

function normalizeIssue(raw: Record<string, unknown>): GitHubIssueEvidence | null {
  if (typeof raw['number'] !== 'number') return null;
  return {
    number: raw['number'],
    title: typeof raw['title'] === 'string' ? raw['title'] : undefined,
    state: typeof raw['state'] === 'string' ? raw['state'] : undefined,
    url: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}
