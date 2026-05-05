var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { gitHeadSha, gitRemote, gitStatus } from './git/api.js';
import { parseGitHubRemoteUrl } from './github-delivery-evidence.js';
export function getGitHubDeliveryReadiness(workspace_1) {
    return __awaiter(this, arguments, void 0, function* (workspace, env = process.env, now = () => new Date()) {
        var _a, _b;
        const tokenEnvVar = resolveGitHubTokenEnvVar(env);
        const reasons = [];
        let branch = null;
        let headSha = null;
        let dirtyFileCount = 0;
        let repository = null;
        let remoteConfigured = false;
        let gitAvailable = true;
        if (!tokenEnvVar)
            reasons.push('GitHub token env is missing: set PYRFOR_GITHUB_TOKEN, GITHUB_TOKEN or GH_TOKEN.');
        try {
            const status = yield gitStatus(workspace);
            branch = status.branch;
            dirtyFileCount = status.files.length;
            try {
                headSha = yield gitHeadSha(workspace);
            }
            catch (_c) {
                headSha = null;
            }
            try {
                const remote = yield gitRemote(workspace);
                remoteConfigured = Boolean(remote === null || remote === void 0 ? void 0 : remote.url);
                repository = (_b = (_a = parseGitHubRemoteUrl(remote === null || remote === void 0 ? void 0 : remote.url)) === null || _a === void 0 ? void 0 : _a.fullName) !== null && _b !== void 0 ? _b : null;
            }
            catch (_d) {
                remoteConfigured = false;
                repository = null;
            }
            if (!branch || branch === 'HEAD')
                reasons.push('Git branch is unavailable or detached.');
            if (!headSha)
                reasons.push('Git HEAD sha is unavailable; create an initial commit.');
            if (!remoteConfigured)
                reasons.push('Git origin remote is missing.');
            if (remoteConfigured && !repository)
                reasons.push('Git origin remote is not a GitHub repository.');
            if (dirtyFileCount > 0)
                reasons.push(`Workspace has ${dirtyFileCount} dirty file(s).`);
        }
        catch (err) {
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
    });
}
function resolveGitHubTokenEnvVar(env) {
    var _a, _b, _c;
    if ((_a = env['PYRFOR_GITHUB_TOKEN']) === null || _a === void 0 ? void 0 : _a.trim())
        return 'PYRFOR_GITHUB_TOKEN';
    if ((_b = env['GITHUB_TOKEN']) === null || _b === void 0 ? void 0 : _b.trim())
        return 'GITHUB_TOKEN';
    if ((_c = env['GH_TOKEN']) === null || _c === void 0 ? void 0 : _c.trim())
        return 'GH_TOKEN';
    return null;
}
function classifyGitReadinessError(err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('not a git repository'))
        return 'Workspace is not a git repository.';
    if (message.includes('does not exist'))
        return 'Workspace does not exist.';
    if (message.includes('not a directory'))
        return 'Workspace is not a directory.';
    if (message.includes('must be an absolute path'))
        return 'Workspace path is invalid.';
    return 'Git workspace is unavailable.';
}
