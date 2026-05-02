var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { gitHeadSha, gitLog, gitRemote, gitStatus } from './git/api.js';
export function parseGitHubRemoteUrl(remoteUrl) {
    if (!remoteUrl)
        return null;
    const trimmed = remoteUrl.trim();
    const patterns = [
        /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
        /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
        /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
        /^http:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
    ];
    for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (!match)
            continue;
        const owner = match[1];
        const repo = match[2].replace(/\.git$/, '');
        return { owner, repo, fullName: `${owner}/${repo}` };
    }
    try {
        const url = new URL(trimmed);
        if (url.hostname !== 'github.com')
            return null;
        const [owner, repo] = url.pathname.replace(/^\//, '').split('/');
        if (!owner || !repo)
            return null;
        const cleanRepo = repo.replace(/\.git$/, '');
        return { owner, repo: cleanRepo, fullName: `${owner}/${cleanRepo}` };
    }
    catch (_a) {
        // Fall through to unsupported remote syntax.
    }
    return null;
}
export function sanitizeGitRemoteUrl(remoteUrl) {
    try {
        const url = new URL(remoteUrl);
        url.username = '';
        url.password = '';
        return url.toString().replace(/\/$/, '');
    }
    catch (_a) {
        return remoteUrl;
    }
}
export function captureDeliveryEvidence(options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const git = yield captureLocalGitEvidence(options.workspace);
        const repository = parseGitHubRemoteUrl((_a = git.remote) === null || _a === void 0 ? void 0 : _a.url);
        const github = yield captureGitHubEvidence({
            repository,
            branchName: git.branch,
            headSha: git.headSha,
            issueNumber: options.issueNumber,
            githubToken: options.githubToken,
            fetchImpl: options.fetchImpl,
        });
        return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ schemaVersion: 'pyrfor.delivery_evidence.v1', capturedAt: new Date().toISOString(), runId: options.runId }, (options.summary ? { summary: options.summary } : {})), (options.verifierStatus ? { verifierStatus: options.verifierStatus } : {})), { deliveryChecklist: (_b = options.deliveryChecklist) !== null && _b !== void 0 ? _b : [] }), (options.deliveryArtifactId ? { deliveryArtifactId: options.deliveryArtifactId } : {})), { git,
            github });
    });
}
function captureLocalGitEvidence(workspace) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const [status, headSha, remote, latestCommits] = yield Promise.all([
                gitStatus(workspace),
                gitHeadSha(workspace),
                gitRemote(workspace),
                gitLog(workspace, 5),
            ]);
            const sanitizedRemoteUrl = remote ? sanitizeGitRemoteUrl(remote.url) : null;
            const repository = parseGitHubRemoteUrl(remote === null || remote === void 0 ? void 0 : remote.url);
            return {
                available: true,
                branch: status.branch,
                headSha,
                ahead: status.ahead,
                behind: status.behind,
                dirtyFiles: status.files.slice(0, 100),
                latestCommits,
                remote: remote && sanitizedRemoteUrl ? Object.assign({ name: remote.name, url: sanitizedRemoteUrl }, (repository ? { repository: repository.fullName } : {})) : null,
            };
        }
        catch (err) {
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
    });
}
function captureGitHubEvidence(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const base = Object.assign(Object.assign({ provider: 'github', available: false, repository: (_b = (_a = input.repository) === null || _a === void 0 ? void 0 : _a.fullName) !== null && _b !== void 0 ? _b : null, branch: null, pullRequests: [], workflowRuns: [] }, (input.issueNumber ? { issue: null } : {})), { errors: [] });
        const fetchImpl = (_c = input.fetchImpl) !== null && _c !== void 0 ? _c : globalThis.fetch;
        if (!input.repository || !input.branchName || input.branchName === 'HEAD' || typeof fetchImpl !== 'function') {
            return base;
        }
        const request = (scope, path) => __awaiter(this, void 0, void 0, function* () {
            const headers = {
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
            };
            if (input.githubToken)
                headers['Authorization'] = `Bearer ${input.githubToken}`;
            try {
                const res = yield fetchImpl(new URL(path, 'https://api.github.com').toString(), { headers });
                if (!res.ok) {
                    base.errors.push({ scope, status: res.status, message: `GitHub API returned ${res.status}` });
                    return null;
                }
                return yield res.json();
            }
            catch (err) {
                base.errors.push({ scope, message: err instanceof Error ? err.message : 'GitHub API request failed' });
                return null;
            }
        });
        const { owner, repo } = input.repository;
        const branchPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(input.branchName)}`;
        const prPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(`${owner}:${input.branchName}`)}&state=all&per_page=5`;
        const workflowPath = input.headSha
            ? `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?head_sha=${encodeURIComponent(input.headSha)}&per_page=5`
            : null;
        const issuePath = input.issueNumber
            ? `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${input.issueNumber}`
            : null;
        const [branch, pulls, workflowRuns, issue] = yield Promise.all([
            request('branch', branchPath),
            request('pull_requests', prPath),
            workflowPath ? request('workflow_runs', workflowPath) : Promise.resolve(null),
            issuePath ? request('issue', issuePath) : Promise.resolve(null),
        ]);
        base.branch = normalizeBranch(input.branchName, branch);
        base.pullRequests = Array.isArray(pulls) ? pulls.map(normalizePullRequest).filter(isDefined) : [];
        base.workflowRuns = Array.isArray(workflowRuns === null || workflowRuns === void 0 ? void 0 : workflowRuns.workflow_runs)
            ? workflowRuns.workflow_runs.map(normalizeWorkflowRun).filter(isDefined)
            : [];
        base.issue = issue ? normalizeIssue(issue) : base.issue;
        base.available = Boolean(branch || pulls || workflowRuns || issue);
        return base;
    });
}
function normalizeBranch(branchName, branch) {
    const commit = isRecord(branch === null || branch === void 0 ? void 0 : branch['commit']) ? branch['commit'] : null;
    return {
        name: branchName,
        protected: typeof (branch === null || branch === void 0 ? void 0 : branch['protected']) === 'boolean' ? branch['protected'] : undefined,
        commitSha: typeof (commit === null || commit === void 0 ? void 0 : commit['sha']) === 'string' ? commit.sha : undefined,
        url: typeof (branch === null || branch === void 0 ? void 0 : branch['_links']) === 'object' && (branch === null || branch === void 0 ? void 0 : branch['_links']) !== null
            && typeof branch['_links']['html'] === 'string'
            ? String(branch['_links']['html'])
            : undefined,
    };
}
function normalizePullRequest(raw) {
    if (!isRecord(raw) || typeof raw['number'] !== 'number' || typeof raw['html_url'] !== 'string')
        return null;
    const mergedAt = typeof raw['merged_at'] === 'string' && raw['merged_at'].length > 0;
    const head = isRecord(raw['head']) ? raw['head'] : null;
    const base = isRecord(raw['base']) ? raw['base'] : null;
    return {
        number: raw['number'],
        title: typeof raw['title'] === 'string' ? raw['title'] : undefined,
        state: mergedAt ? 'merged' : raw['state'] === 'closed' ? 'closed' : 'open',
        url: raw['html_url'],
        headRef: typeof (head === null || head === void 0 ? void 0 : head['ref']) === 'string' ? head.ref : undefined,
        baseRef: typeof (base === null || base === void 0 ? void 0 : base['ref']) === 'string' ? base.ref : undefined,
    };
}
function normalizeWorkflowRun(raw) {
    if (!isRecord(raw) || typeof raw['id'] !== 'number')
        return null;
    return {
        id: raw['id'],
        name: typeof raw['name'] === 'string' ? raw['name'] : undefined,
        status: typeof raw['status'] === 'string' ? raw['status'] : undefined,
        conclusion: typeof raw['conclusion'] === 'string' ? raw['conclusion'] : null,
        url: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
        headSha: typeof raw['head_sha'] === 'string' ? raw['head_sha'] : undefined,
    };
}
function normalizeIssue(raw) {
    if (typeof raw['number'] !== 'number')
        return null;
    return {
        number: raw['number'],
        title: typeof raw['title'] === 'string' ? raw['title'] : undefined,
        state: typeof raw['state'] === 'string' ? raw['state'] : undefined,
        url: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isDefined(value) {
    return value !== null && value !== undefined;
}
