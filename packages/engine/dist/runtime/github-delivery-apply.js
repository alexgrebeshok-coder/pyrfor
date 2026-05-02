var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { gitHeadSha, gitPushHeadToBranch, gitRemote, gitStatus } from './git/api.js';
import { parseGitHubRemoteUrl } from './github-delivery-evidence.js';
export function validateGithubDeliveryApplyPreconditions(options) {
    return __awaiter(this, void 0, void 0, function* () {
        const { workspace, runId, plan, planArtifact, expectedPlanSha256 } = options;
        if (plan.runId !== runId)
            throw new Error(`GitHubDeliveryApply: plan does not belong to run ${runId}`);
        if (!planArtifact.sha256 || planArtifact.sha256 !== expectedPlanSha256) {
            throw new Error('GitHubDeliveryApply: plan artifact sha mismatch');
        }
        if (!plan.applySupported)
            throw new Error('GitHubDeliveryApply: plan does not support apply');
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
        const [status, headSha, remote] = yield Promise.all([
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
        const remoteRepo = parseGitHubRemoteUrl(remote === null || remote === void 0 ? void 0 : remote.url);
        if (!remoteRepo || remoteRepo.fullName !== plan.repository) {
            throw new Error('GitHubDeliveryApply: workspace remote does not match reviewed repository');
        }
    });
}
export function applyGithubDeliveryPlan(options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const { workspace, runId, plan, planArtifact, approvalId, githubToken } = options;
        const repository = parseRepository(plan.repository);
        const baseBranch = requirePlanString(plan.baseBranch, 'base branch');
        const headSha = requirePlanString(plan.headSha, 'head sha');
        const fetchImpl = (_a = options.fetchImpl) !== null && _a !== void 0 ? _a : globalThis.fetch;
        if (typeof fetchImpl !== 'function')
            throw new Error('GitHubDeliveryApply: fetch is unavailable');
        if (!githubToken)
            throw new Error('GitHubDeliveryApply: GitHub token is unavailable');
        yield validateGithubDeliveryApplyPreconditions({
            workspace,
            runId,
            plan,
            planArtifact,
            expectedPlanSha256: (_b = planArtifact.sha256) !== null && _b !== void 0 ? _b : '',
        });
        const existingBranchSha = yield getRemoteBranchSha(fetchImpl, githubToken, repository.owner, repository.repo, plan.proposedBranch);
        if (existingBranchSha && existingBranchSha !== headSha) {
            throw new Error('GitHubDeliveryApply: remote delivery branch points at a different commit');
        }
        if (!existingBranchSha) {
            yield gitPushHeadToBranch(workspace, (_c = options.remoteName) !== null && _c !== void 0 ? _c : 'origin', plan.proposedBranch);
        }
        const existingPr = yield findExistingDraftPr(fetchImpl, githubToken, {
            owner: repository.owner,
            repo: repository.repo,
            headOwner: repository.owner,
            branch: plan.proposedBranch,
            base: baseBranch,
        });
        const draftPullRequest = existingPr !== null && existingPr !== void 0 ? existingPr : yield createDraftPullRequest(fetchImpl, githubToken, {
            owner: repository.owner,
            repo: repository.repo,
            title: plan.pullRequest.title,
            body: plan.pullRequest.body,
            head: plan.proposedBranch,
            base: baseBranch,
        });
        return Object.assign(Object.assign({ schemaVersion: 'pyrfor.github_delivery_apply.v1', appliedAt: new Date().toISOString(), mode: 'draft_pr', runId, repository: plan.repository, baseBranch, branch: plan.proposedBranch, headSha, planArtifactId: planArtifact.id, planSha256: planArtifact.sha256 }, (plan.evidenceArtifactId ? { evidenceArtifactId: plan.evidenceArtifactId } : {})), { approvalId, idempotencyKey: buildApplyIdempotencyKey(runId, planArtifact, plan), draftPullRequest });
    });
}
export function buildApplyIdempotencyKey(runId, planArtifact, plan) {
    var _a, _b;
    return [
        runId,
        planArtifact.id,
        (_a = planArtifact.sha256) !== null && _a !== void 0 ? _a : 'no-sha',
        plan.proposedBranch,
        (_b = plan.headSha) !== null && _b !== void 0 ? _b : 'no-head',
    ].join(':');
}
function getRemoteBranchSha(fetchImpl, token, owner, repo, branch) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield githubRequest(fetchImpl, token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`, {
            method: 'GET',
            allow404: true,
        });
        if (!isRecord(res))
            return null;
        const commit = isRecord(res['commit']) ? res['commit'] : null;
        return typeof (commit === null || commit === void 0 ? void 0 : commit['sha']) === 'string' ? commit.sha : null;
    });
}
function findExistingDraftPr(fetchImpl, token, input) {
    return __awaiter(this, void 0, void 0, function* () {
        const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls?head=${encodeURIComponent(`${input.headOwner}:${input.branch}`)}&base=${encodeURIComponent(input.base)}&state=open&per_page=5`;
        const raw = yield githubRequest(fetchImpl, token, path, { method: 'GET' });
        if (!Array.isArray(raw))
            return null;
        for (const item of raw) {
            const pr = normalizePullRequest(item);
            if (pr && pr.draft)
                return pr;
        }
        return null;
    });
}
function createDraftPullRequest(fetchImpl, token, input) {
    return __awaiter(this, void 0, void 0, function* () {
        const raw = yield githubRequest(fetchImpl, token, `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls`, {
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
        if (!pr)
            throw new Error('GitHubDeliveryApply: GitHub returned an invalid pull request response');
        return pr;
    });
}
function githubRequest(fetchImpl, token, path, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield fetchImpl(new URL(path, 'https://api.github.com').toString(), Object.assign({ method: options.method, headers: {
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
                Authorization: `Bearer ${token}`,
            } }, (options.body ? { body: options.body } : {})));
        if (options.allow404 && res.status === 404)
            return null;
        if (!res.ok)
            throw new Error(`GitHubDeliveryApply: GitHub API returned ${res.status}`);
        return yield res.json();
    });
}
function parseRepository(repository) {
    var _a;
    const [owner, repo] = (_a = repository === null || repository === void 0 ? void 0 : repository.split('/')) !== null && _a !== void 0 ? _a : [];
    if (!owner || !repo)
        throw new Error('GitHubDeliveryApply: invalid GitHub repository');
    return { owner, repo };
}
function requirePlanString(value, field) {
    if (!value)
        throw new Error(`GitHubDeliveryApply: plan is missing ${field}`);
    return value;
}
function normalizePullRequest(raw) {
    if (!isRecord(raw) || typeof raw['number'] !== 'number' || typeof raw['html_url'] !== 'string')
        return null;
    const head = isRecord(raw['head']) ? raw['head'] : null;
    const base = isRecord(raw['base']) ? raw['base'] : null;
    return {
        number: raw['number'],
        url: raw['html_url'],
        title: typeof raw['title'] === 'string' ? raw['title'] : `PR #${raw['number']}`,
        state: typeof raw['state'] === 'string' ? raw['state'] : 'open',
        draft: raw['draft'] === true,
        headRef: typeof (head === null || head === void 0 ? void 0 : head['ref']) === 'string' ? head.ref : '',
        baseRef: typeof (base === null || base === void 0 ? void 0 : base['ref']) === 'string' ? base.ref : '',
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
