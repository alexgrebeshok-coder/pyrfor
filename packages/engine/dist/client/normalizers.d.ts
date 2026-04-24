import type { DashboardState, Milestone, Project, ProjectStatus, ProjectDocument, Risk, Task, TaskStatus, TeamMember } from '../types/types';
export type ApiTeamMember = {
    id: string;
    name: string;
    initials?: string | null;
    role: string;
    email?: string | null;
    avatar?: string | null;
    capacity: number;
    activeTasks?: number;
    capacityUsed?: number;
    projects?: Array<{
        id: string;
        name?: string | null;
    } | string>;
};
export type ApiTask = {
    id: string;
    title: string;
    description?: string | null;
    status: string;
    priority: string;
    order: number;
    dueDate: string;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    projectId: string;
    assigneeId?: string | null;
    assignee?: ApiTeamMember | null;
    blockedReason?: string | null;
    dependencySummary?: {
        dependencyCount: number;
        dependentCount: number;
        blockingDependencyCount: number;
        downstreamImpactCount: number;
        blockedByDependencies: boolean;
        earliestBlockingDueDate: string | null;
        blockingDependencies: Array<{
            id: string;
            title: string;
            status: string;
            dueDate: string;
            type: string;
        }>;
    } | null;
};
export type ApiRisk = {
    id: string;
    title: string;
    description?: string | null;
    probability: string;
    impact: string;
    severity: number;
    status: string;
    projectId: string;
    ownerId?: string | null;
    owner?: ApiTeamMember | null;
};
export type ApiMilestone = {
    id: string;
    title: string;
    description?: string | null;
    date: string;
    status: string;
    projectId: string;
};
export type ApiDocument = {
    id: string;
    title: string;
    description?: string | null;
    filename: string;
    url: string;
    type: string;
    size?: number | null;
    projectId: string;
    ownerId?: string | null;
    updatedAt: string;
    owner?: ApiTeamMember | null;
};
export type ApiProject = {
    id: string;
    name?: string | null;
    description?: string | null;
    status: string;
    direction: string;
    priority: string;
    health: string | number;
    start?: string;
    end?: string;
    createdAt: string;
    updatedAt: string;
    budgetPlan?: number | null;
    budgetFact?: number | null;
    progress: number;
    location?: string | null;
    tasks?: ApiTask[];
    team?: Array<ApiTeamMember | string>;
    risks?: ApiRisk[] | number;
    milestones?: ApiMilestone[];
    documents?: ApiDocument[];
    budget?: {
        planned?: number | null;
        actual?: number | null;
        currency?: string | null;
    };
    dates?: {
        start?: string | null;
        end?: string | null;
    };
    nextMilestone?: {
        name?: string | null;
        date?: string | null;
    } | null;
    history?: Project["history"];
};
export declare function normalizeTaskStatus(status: string): TaskStatus;
export declare function denormalizeTaskStatus(status: TaskStatus): string;
export declare function normalizeProjectStatus(status: string): ProjectStatus;
export declare function denormalizeProjectStatus(status: ProjectStatus): string;
export declare function normalizeTaskDependencySummary(summary: ApiTask["dependencySummary"]): Task["dependencySummary"] | undefined;
export declare function normalizeTask(task: ApiTask): Task;
export declare function normalizeTeamMember(member: ApiTeamMember): TeamMember;
export declare function normalizeRisk(risk: ApiRisk): Risk;
export declare function normalizeMilestone(milestone: ApiMilestone): Milestone;
export declare function normalizeDocument(document: ApiDocument): ProjectDocument;
export declare function normalizeProject(project: ApiProject): Project;
export declare function buildDashboardStateFromApi(input: {
    projects?: ApiProject[];
    tasks?: ApiTask[];
    team?: ApiTeamMember[];
    risks?: ApiRisk[];
}): DashboardState;
//# sourceMappingURL=normalizers.d.ts.map