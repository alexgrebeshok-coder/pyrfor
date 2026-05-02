import type { RunRecord } from './run-lifecycle';
import type { DeliveryEvidenceSnapshot } from './github-delivery-evidence';
export interface GitHubDeliveryPlanInput {
    run: RunRecord;
    evidence: DeliveryEvidenceSnapshot;
    evidenceArtifactId?: string;
    issueNumber?: number;
    title?: string;
    body?: string;
    applySupported?: boolean;
    applyBlockers?: string[];
}
export interface GitHubDeliveryPlan {
    schemaVersion: 'pyrfor.github_delivery_plan.v1';
    createdAt: string;
    runId: string;
    mode: 'dry_run';
    applySupported: boolean;
    approvalRequired: true;
    repository: string | null;
    baseBranch: string | null;
    headSha: string | null;
    proposedBranch: string;
    pullRequest: {
        title: string;
        body: string;
        draft: true;
    };
    issue?: {
        number: number;
        commentBody: string;
    };
    ci: {
        observeWorkflowRuns: Array<{
            id: number;
            name?: string;
            status?: string;
            conclusion?: string | null;
            url?: string;
        }>;
    };
    blockers: string[];
    evidenceArtifactId?: string;
    provenance: {
        repository: string | null;
        baseBranch: string | null;
        headSha: string | null;
        evidenceArtifactId?: string;
    };
}
export declare function buildGithubDeliveryPlan(input: GitHubDeliveryPlanInput): GitHubDeliveryPlan;
//# sourceMappingURL=github-delivery-plan.d.ts.map