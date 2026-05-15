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

export async function resolveToolPermission(
  req: ToolLoopApprovalRequest,
  options: PermissionApprovalGateOptions,
): Promise<PermissionResolution> {
  const policy = await options.permissionEngine.check(
    req.toolName,
    options.permissionContext,
    req.args,
  );

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

  let approvalDecision: FlowApprovalDecision;
  try {
    approvalDecision = await options.requestApproval({
      id: req.id,
      toolName: req.toolName,
      summary: req.summary,
      args: req.args,
    });
  } catch {
    approvalDecision = 'deny';
  }

  if (approvalDecision === 'approve' && policy.permissionClass === 'ask_once') {
    options.permissionEngine.recordApproval(options.permissionContext.workspaceId, req.toolName);
  }

  return {
    toolName: req.toolName,
    decision: approvalDecision,
    permissionClass: policy.permissionClass,
    reason:
      approvalDecision === 'approve'
        ? policy.permissionClass === 'ask_once'
          ? 'approved_and_recorded'
          : 'approved'
        : policy.reason,
    promptUser: policy.promptUser,
    policy,
  };
}

export function createPermissionApprovalGate(
  options: PermissionApprovalGateOptions,
): ApprovalGate {
  return async (req) => resolveToolPermission(req, options);
}
