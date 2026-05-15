var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function resolveToolPermission(req, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const policy = yield options.permissionEngine.check(req.toolName, options.permissionContext, req.args);
        if (policy.allow) {
            return {
                toolName: req.toolName,
                decision: 'approve',
                permissionClass: policy.permissionClass,
                reason: policy.reason,
                promptUser: policy.promptUser,
                policy,
            };
        }
        if (!policy.promptUser || !options.requestApproval) {
            return {
                toolName: req.toolName,
                decision: 'deny',
                permissionClass: policy.permissionClass,
                reason: options.requestApproval ? policy.reason : 'approval_unavailable',
                promptUser: policy.promptUser,
                policy,
            };
        }
        let approvalDecision;
        try {
            approvalDecision = yield options.requestApproval({
                id: req.id,
                toolName: req.toolName,
                summary: req.summary,
                args: req.args,
            });
        }
        catch (_a) {
            approvalDecision = 'deny';
        }
        if (approvalDecision === 'approve' && policy.permissionClass === 'ask_once') {
            options.permissionEngine.recordApproval(options.permissionContext.workspaceId, req.toolName);
        }
        return {
            toolName: req.toolName,
            decision: approvalDecision,
            permissionClass: policy.permissionClass,
            reason: approvalDecision === 'approve'
                ? policy.permissionClass === 'ask_once'
                    ? 'approved_and_recorded'
                    : 'approved'
                : policy.reason,
            promptUser: policy.promptUser,
            policy,
        };
    });
}
export function createPermissionApprovalGate(options) {
    return (req) => __awaiter(this, void 0, void 0, function* () { return resolveToolPermission(req, options); });
}
