import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { stableStringify } from '../context-pack.js';
export function createEffectGateway() {
    const journalEntries = [];
    function authorize(request) {
        var _a, _b;
        if (request.tierDecision === 'block') {
            return deny(request, 'blocked by tier decider');
        }
        if (!request.capability.declaredEffects.includes(request.effect)) {
            return deny(request, `effect "${request.effect}" is not declared by capability manifest`);
        }
        if ((request.effect === 'fs.read' || request.effect === 'fs.write') && request.targetPath) {
            if (!isPathAllowed(request.targetPath, (_a = request.capability.fsScope) !== null && _a !== void 0 ? _a : [])) {
                return deny(request, `path outside declared fsScope: ${request.targetPath}`);
            }
        }
        if ((request.effect === 'net.out' || request.effect === 'net.in') && request.url) {
            if (!isUrlAllowed(request.url, (_b = request.capability.egressAllowlist) !== null && _b !== void 0 ? _b : [])) {
                return deny(request, `url outside declared egressAllowlist: ${request.url}`);
            }
        }
        const budgetReason = checkBudget(request);
        if (budgetReason)
            return deny(request, budgetReason);
        return Object.assign({ allowed: true, reason: 'effect allowed by capability manifest', effect: request.effect, toolName: request.toolName }, decisionMetadata(request));
    }
    function journal(entry) {
        if (!entry.decision.allowed)
            throw new Error('EffectGateway: denied effects cannot be journaled as allowed');
        const line = `${stableStringify({
            artifactId: entry.artifactId,
            decision: entry.decision,
            request: entry.request,
        })}\n`;
        journalEntries.push(line);
        return line;
    }
    return {
        authorize,
        journal,
        entries: () => [...journalEntries],
    };
}
function deny(request, reason) {
    return Object.assign({ allowed: false, reason, effect: request.effect, toolName: request.toolName }, decisionMetadata(request));
}
function decisionMetadata(request) {
    return Object.assign(Object.assign(Object.assign(Object.assign({}, (request.decisionVectorRef !== undefined ? { decisionVectorRef: request.decisionVectorRef } : {})), (request.tierDecision !== undefined ? { tierDecision: request.tierDecision } : {})), (request.tierReasonCodes !== undefined ? { reasonCodes: request.tierReasonCodes } : {})), (request.requiresApproval !== undefined ? { requiresApproval: request.requiresApproval } : {}));
}
function isPathAllowed(targetPath, fsScope) {
    if (fsScope.length === 0)
        return false;
    const resolvedTarget = realpathAwareResolve(targetPath);
    if (!resolvedTarget)
        return false;
    return fsScope.some((scope) => {
        const resolvedScope = realpathAwareResolve(scope);
        if (!resolvedScope)
            return false;
        return resolvedTarget === resolvedScope || resolvedTarget.startsWith(`${resolvedScope}${path.sep}`);
    });
}
function realpathAwareResolve(inputPath) {
    const resolved = path.resolve(inputPath);
    if (pathExistsLexically(resolved))
        return safeRealpath(resolved);
    let suffix = [];
    let candidate = resolved;
    while (!pathExistsLexically(candidate)) {
        const parent = path.dirname(candidate);
        if (parent === candidate)
            return resolved;
        suffix = [path.basename(candidate), ...suffix];
        candidate = parent;
    }
    const realCandidate = safeRealpath(candidate);
    if (!realCandidate)
        return undefined;
    return path.join(realCandidate, ...suffix);
}
function pathExistsLexically(inputPath) {
    try {
        lstatSync(inputPath);
        return true;
    }
    catch (_a) {
        return false;
    }
}
function safeRealpath(inputPath) {
    try {
        return realpathSync(inputPath);
    }
    catch (_a) {
        return undefined;
    }
}
function isUrlAllowed(rawUrl, allowlist) {
    if (allowlist.length === 0)
        return false;
    let host;
    try {
        host = new URL(rawUrl).host;
    }
    catch (_a) {
        return false;
    }
    return allowlist.some((allowed) => host === allowed);
}
function checkBudget(request) {
    var _a, _b, _c, _d, _e, _f;
    const budget = request.capability.perCallBudget;
    if (!budget)
        return undefined;
    if (budget.tokensUSD !== undefined && ((_a = request.estimatedCostUsd) !== null && _a !== void 0 ? _a : 0) > budget.tokensUSD) {
        return `estimated cost exceeds per-call budget: ${(_b = request.estimatedCostUsd) !== null && _b !== void 0 ? _b : 0} > ${budget.tokensUSD}`;
    }
    if (budget.wallMs !== undefined && ((_c = request.estimatedWallMs) !== null && _c !== void 0 ? _c : 0) > budget.wallMs) {
        return `estimated wall time exceeds per-call budget: ${(_d = request.estimatedWallMs) !== null && _d !== void 0 ? _d : 0} > ${budget.wallMs}`;
    }
    if (budget.egressKB !== undefined && ((_e = request.estimatedEgressBytes) !== null && _e !== void 0 ? _e : 0) > budget.egressKB * 1024) {
        return `estimated egress exceeds per-call budget: ${(_f = request.estimatedEgressBytes) !== null && _f !== void 0 ? _f : 0} > ${budget.egressKB * 1024}`;
    }
    return undefined;
}
