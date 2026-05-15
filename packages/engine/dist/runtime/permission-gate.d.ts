import type { ApprovalDecision as FlowApprovalDecision, ApprovalRequest as FlowApprovalRequest } from './approval-flow';
import type { Decision, PermissionContext, PermissionEngine } from './permission-engine';
import type { ApprovalGate, ApprovalGateResult, ApprovalRequest as ToolLoopApprovalRequest } from './tool-loop';
export interface PermissionApprovalGateOptions {
    permissionEngine: PermissionEngine;
    permissionContext: PermissionContext;
    requestApproval?: (req: FlowApprovalRequest) => Promise<FlowApprovalDecision>;
}
export interface PermissionResolution extends ApprovalGateResult {
    toolName: string;
    policy: Decision;
}
export declare function resolveToolPermission(req: ToolLoopApprovalRequest, options: PermissionApprovalGateOptions): Promise<PermissionResolution>;
export declare function createPermissionApprovalGate(options: PermissionApprovalGateOptions): ApprovalGate;
//# sourceMappingURL=permission-gate.d.ts.map