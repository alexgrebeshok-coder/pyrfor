import type { Prisma } from "@prisma/client";
type GoalListRecord = Prisma.GoalGetPayload<{
    include: {
        children: {
            select: {
                id: true;
                title: true;
                level: true;
                status: true;
                ownerAgentId: true;
            };
        };
        _count: {
            select: {
                children: true;
                taskLinks: true;
            };
        };
    };
}>;
export type GoalTreeNode = GoalListRecord & {
    progress: number;
    subGoals: GoalTreeNode[];
};
export interface CreateGoalInput {
    workspaceId: string;
    parentId?: string | null;
    title: string;
    description?: string | null;
    level?: string;
    ownerAgentId?: string | null;
}
export interface UpdateGoalInput {
    title?: string;
    description?: string | null;
    status?: string;
    level?: string;
    parentId?: string | null;
    ownerAgentId?: string | null;
}
export declare function listGoals(workspaceId: string, opts?: {
    flat?: boolean;
}): Promise<({
    _count: {
        children: number;
        taskLinks: number;
    };
    children: {
        id: string;
        title: string;
        status: string;
        level: string;
        ownerAgentId: string | null;
    }[];
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    title: string;
    projectId: string | null;
    status: string;
    description: string | null;
    workspaceId: string;
    level: string;
    parentId: string | null;
    ownerAgentId: string | null;
} & {
    progress: number;
})[]>;
export declare function getGoal(id: string): Promise<({
    _count: {
        children: number;
        taskLinks: number;
    };
    parent: {
        id: string;
        title: string;
    } | null;
    children: {
        id: string;
        title: string;
        status: string;
        level: string;
        ownerAgentId: string | null;
    }[];
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    title: string;
    projectId: string | null;
    status: string;
    description: string | null;
    workspaceId: string;
    level: string;
    parentId: string | null;
    ownerAgentId: string | null;
} & {
    progress: number;
}) | null>;
export declare function createGoal(input: CreateGoalInput): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    title: string;
    projectId: string | null;
    status: string;
    description: string | null;
    workspaceId: string;
    level: string;
    parentId: string | null;
    ownerAgentId: string | null;
}>;
export declare function updateGoal(id: string, input: UpdateGoalInput): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    title: string;
    projectId: string | null;
    status: string;
    description: string | null;
    workspaceId: string;
    level: string;
    parentId: string | null;
    ownerAgentId: string | null;
}>;
export declare function deleteGoal(id: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    title: string;
    projectId: string | null;
    status: string;
    description: string | null;
    workspaceId: string;
    level: string;
    parentId: string | null;
    ownerAgentId: string | null;
}>;
export {};
//# sourceMappingURL=goal-service.d.ts.map