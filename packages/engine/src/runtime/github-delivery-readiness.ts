import { gitHeadSha, gitRemote, gitStatus } from './git/api.js';
import { parseGitHubRemoteUrl } from './github-delivery-evidence.js';

export interface GitHubDeliveryReadiness {
  checkedAt: string;
  statusSource: 'local-config';
  liveProbeSkipped: true;
  approvalRequired: true;
  status: 'ready' | 'unavailable';
  tokenConfigured: boolean;
  tokenEnvVar: 'PYRFOR_GITHUB_TOKEN' | 'GITHUB_TOKEN' | 'GH_TOKEN' | null;
  git: {
    available: boolean;
    branch: string | null;
    headSha: string | null;
    dirtyFileCount: number;
  };
  github: {
    repository: string | null;
    remoteConfigured: boolean;
  };
  reasons: string[];
  nextStep: string;
}

export async function getGitHubDeliveryReadiness(
  workspace: string,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): Promise<GitHubDeliveryReadiness> {
  const tokenEnvVar = resolveGitHubTokenEnvVar(env);
  const reasons: string[] = [];
  let branch: string | null = null;
  let headSha: string | null = null;
  let dirtyFileCount = 0;
  let repository: string | null = null;
  let remoteConfigured = false;
  let gitAvailable = true;

  if (!tokenEnvVar) reasons.push('GitHub token env is missing: set PYRFOR_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN.');

  try {
    const status = await gitStatus(workspace);
    branch = status.branch;
    dirtyFileCount = status.files.length;

    try {
      headSha = await gitHeadSha(workspace);
    } catch {
      headSha = null;
    }

    try {
      const remote = await gitRemote(workspace);
      remoteConfigured = Boolean(remote?.url);
      repository = parseGitHubRemoteUrl(remote?.url)?.fullName ?? null;
    } catch {
      remoteConfigured = false;
      repository = null;
    }

    if (!branch || branch === 'HEAD') reasons.push('Git branch is unavailable or detached.');
    if (!headSha) reasons.push('Git HEAD sha is unavailable; create an initial commit.');
    if (!remoteConfigured) reasons.push('Git origin remote is missing.');
    if (remoteConfigured && !repository) reasons.push('Git origin remote is not a GitHub repository.');
    if (dirtyFileCount > 0) reasons.push(`Workspace has ${dirtyFileCount} dirty file(s).`);
  } catch (err) {
    gitAvailable = false;
    reasons.push(classifyGitReadinessError(err));
  }

  const status = reasons.length === 0 ? 'ready' : 'unavailable';
  return {
    checkedAt: now().toISOString(),
    statusSource: 'local-config',
    liveProbeSkipped: true,
    approvalRequired: true,
    status,
    tokenConfigured: Boolean(tokenEnvVar),
    tokenEnvVar,
    git: {
      available: gitAvailable,
      branch,
      headSha,
      dirtyFileCount,
    },
    github: {
      repository,
      remoteConfigured,
    },
    reasons: reasons.length > 0 ? reasons : ['Local GitHub delivery prerequisites are configured.'],
    nextStep: status === 'ready'
      ? 'Review verifier status, create a dry-run delivery plan, then request GitHub apply approval.'
      : 'Set the missing local Git/GitHub prerequisites before planning or applying delivery.',
  };
}

function resolveGitHubTokenEnvVar(env: NodeJS.ProcessEnv): GitHubDeliveryReadiness['tokenEnvVar'] {
  if (env['PYRFOR_GITHUB_TOKEN']?.trim()) return 'PYRFOR_GITHUB_TOKEN';
  if (env['GITHUB_TOKEN']?.trim()) return 'GITHUB_TOKEN';
  if (env['GH_TOKEN']?.trim()) return 'GH_TOKEN';
  return null;
}

function classifyGitReadinessError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('not a git repository')) return 'Workspace is not a git repository.';
  if (message.includes('does not exist')) return 'Workspace does not exist.';
  if (message.includes('not a directory')) return 'Workspace is not a directory.';
  if (message.includes('must be an absolute path')) return 'Workspace path is invalid.';
  return 'Git workspace is unavailable.';
}
