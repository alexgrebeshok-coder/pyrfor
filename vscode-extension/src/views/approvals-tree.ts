import * as vscode from 'vscode';
import type { ApprovalRequest, UniversalApiClient } from '../universal-api';

export type ApprovalTreeNode = { kind: 'approval'; approval: ApprovalRequest };

export class ApprovalsTreeProvider implements vscode.TreeDataProvider<ApprovalTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ApprovalTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private approvals: ApprovalRequest[] = [];

  constructor(private api: UniversalApiClient) {}

  setApi(api: UniversalApiClient): void {
    this.api = api;
    this.approvals = [];
    this._onDidChangeTreeData.fire();
  }

  async refresh(): Promise<void> {
    this.approvals = sortApprovals(await this.api.listPendingApprovals());
    this._onDidChangeTreeData.fire();
  }

  removeApproval(id: string): void {
    this.approvals = this.approvals.filter((approval) => approval.id !== id);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ApprovalTreeNode): vscode.TreeItem {
    const { approval } = element;
    const item = new vscode.TreeItem(approval.summary, vscode.TreeItemCollapsibleState.None);
    item.id = approval.id;
    item.description = approval.toolName;
    item.tooltip = formatApprovalTooltip(approval);
    item.contextValue = 'pyrforApproval';
    return item;
  }

  getChildren(element?: ApprovalTreeNode): ApprovalTreeNode[] {
    if (element) return [];
    return this.approvals.map((approval) => ({ kind: 'approval', approval }));
  }
}

export function approvalFromTreeNode(node: ApprovalTreeNode | undefined): ApprovalRequest | undefined {
  return node?.kind === 'approval' ? node.approval : undefined;
}

function sortApprovals(approvals: ApprovalRequest[]): ApprovalRequest[] {
  return [...approvals].sort((a, b) => {
    const runA = a.run_id ?? '';
    const runB = b.run_id ?? '';
    if (runA !== runB) return runA.localeCompare(runB);
    return a.summary.localeCompare(b.summary);
  });
}

function formatApprovalTooltip(approval: ApprovalRequest): string {
  return [
    approval.summary,
    `ID: ${approval.id}`,
    `Tool: ${approval.toolName}`,
    approval.run_id ? `Run: ${approval.run_id}` : undefined,
    approval.reason ? `Reason: ${approval.reason}` : undefined,
    Object.keys(approval.args).length > 0
      ? `Args: ${JSON.stringify(approval.args, null, 2)}`
      : undefined,
  ].filter(Boolean).join('\n');
}
