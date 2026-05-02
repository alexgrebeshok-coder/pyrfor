import type { GitHubDeliveryPlan } from './github-delivery-plan';
import type { ArtifactRef } from './artifact-model';
import type { ApprovalRequest } from './approval-flow';
type FetchLike = (input: string | URL, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
}) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;
export interface GitHubDeliveryApplyRequest {
    planArtifactId: string;
    expectedPlanSha256: string;
    approvalId?: string;
}
export interface GitHubDeliveryApplyPending {
    status: 'awaiting_approval';
    approval: ApprovalRequest;
    planArtifactId: string;
    expectedPlanSha256: string;
}
export interface GitHubDraftPullRequestResult {
    number: number;
    url: string;
    title: string;
    state: string;
    draft: boolean;
    headRef: string;
    baseRef: string;
}
export interface GitHubDeliveryApplyResult {
    schemaVersion: 'pyrfor.github_delivery_apply.v1';
    appliedAt: string;
    mode: 'draft_pr';
    runId: string;
    repository: string;
    baseBranch: string;
    branch: string;
    headSha: string;
    planArtifactId: string;
    planSha256: string;
    evidenceArtifactId?: string;
    approvalId: string;
    idempotencyKey: string;
    draftPullRequest: GitHubDraftPullRequestResult;
}
export interface GitHubDeliveryApplyApplied {
    status: 'applied';
    artifact: ArtifactRef;
    result: GitHubDeliveryApplyResult;
}
export type GitHubDeliveryApplyResponse = GitHubDeliveryApplyPending | GitHubDeliveryApplyApplied;
export interface GithubDeliveryApplyOptions {
    workspace: string;
    runId: string;
    plan: GitHubDeliveryPlan;
    planArtifact: ArtifactRef;
    approvalId: string;
    githubToken: string;
    remoteName?: string;
    fetchImpl?: FetchLike;
}
export declare function validateGithubDeliveryApplyPreconditions(options: {
    workspace: string;
    runId: string;
    plan: GitHubDeliveryPlan;
    planArtifact: ArtifactRef;
    expectedPlanSha256: string;
}): Promise<void>;
export declare function applyGithubDeliveryPlan(options: GithubDeliveryApplyOptions): Promise<GitHubDeliveryApplyResult>;
export declare function buildApplyIdempotencyKey(runId: string, planArtifact: ArtifactRef, plan: GitHubDeliveryPlan): string;
export {};
//# sourceMappingURL=github-delivery-apply.d.ts.map