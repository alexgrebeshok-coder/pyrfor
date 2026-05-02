import { type GitLogEntry } from './git/api';
type FetchLike = (input: string | URL, init?: {
    method?: string;
    headers?: Record<string, string>;
}) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;
export interface GitHubRepositoryRef {
    owner: string;
    repo: string;
    fullName: string;
}
export interface DeliveryEvidenceGitSnapshot {
    available: boolean;
    branch: string | null;
    headSha: string | null;
    ahead: number;
    behind: number;
    dirtyFiles: Array<{
        path: string;
        x: string;
        y: string;
    }>;
    latestCommits: GitLogEntry[];
    remote?: {
        name: string;
        url: string;
        repository?: string;
    } | null;
    error?: string;
}
export interface GitHubPullRequestEvidence {
    number: number;
    title?: string;
    state: 'open' | 'closed' | 'merged';
    url: string;
    headRef?: string;
    baseRef?: string;
}
export interface GitHubBranchEvidence {
    name: string;
    protected?: boolean;
    commitSha?: string;
    url?: string;
}
export interface GitHubWorkflowRunEvidence {
    id: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    url?: string;
    headSha?: string;
}
export interface GitHubIssueEvidence {
    number: number;
    title?: string;
    state?: string;
    url?: string;
}
export interface GitHubDeliveryEvidence {
    provider: 'github';
    available: boolean;
    repository: string | null;
    branch: GitHubBranchEvidence | null;
    pullRequests: GitHubPullRequestEvidence[];
    workflowRuns: GitHubWorkflowRunEvidence[];
    issue?: GitHubIssueEvidence | null;
    errors: Array<{
        scope: string;
        status?: number;
        message: string;
    }>;
}
export interface DeliveryEvidenceSnapshot {
    schemaVersion: 'pyrfor.delivery_evidence.v1';
    capturedAt: string;
    runId: string;
    summary?: string;
    verifierStatus?: string;
    deliveryChecklist: string[];
    deliveryArtifactId?: string;
    verifier?: {
        status: string;
        rawStatus?: string;
        waivedFrom?: string;
        reason?: string;
        waiverArtifactId?: string;
    };
    git: DeliveryEvidenceGitSnapshot;
    github: GitHubDeliveryEvidence;
}
export interface CaptureDeliveryEvidenceOptions {
    workspace: string;
    runId: string;
    summary?: string;
    verifierStatus?: string;
    deliveryChecklist?: string[];
    deliveryArtifactId?: string;
    issueNumber?: number;
    githubToken?: string;
    fetchImpl?: FetchLike | null;
    verifier?: DeliveryEvidenceSnapshot['verifier'];
}
export declare function parseGitHubRemoteUrl(remoteUrl: string | undefined | null): GitHubRepositoryRef | null;
export declare function sanitizeGitRemoteUrl(remoteUrl: string): string;
export declare function captureDeliveryEvidence(options: CaptureDeliveryEvidenceOptions): Promise<DeliveryEvidenceSnapshot>;
export {};
//# sourceMappingURL=github-delivery-evidence.d.ts.map