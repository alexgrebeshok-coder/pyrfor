"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listGoals = listGoals;
exports.getGoal = getGoal;
exports.createGoal = createGoal;
exports.updateGoal = updateGoal;
exports.deleteGoal = deleteGoal;
const prisma_1 = require("../prisma");
function withGoalProgress(goal) {
    return {
        ...goal,
        progress: 0,
    };
}
function buildGoalTree(goals) {
    const map = new Map();
    for (const goal of goals) {
        map.set(goal.id, {
            ...withGoalProgress(goal),
            subGoals: [],
        });
    }
    const roots = [];
    for (const node of map.values()) {
        if (node.parentId && map.has(node.parentId)) {
            map.get(node.parentId).subGoals.push(node);
        }
        else {
            roots.push(node);
        }
    }
    return roots;
}
async function listGoals(workspaceId, opts) {
    const goals = await prisma_1.prisma.goal.findMany({
        where: { workspaceId },
        include: {
            children: {
                select: {
                    id: true,
                    title: true,
                    level: true,
                    status: true,
                    ownerAgentId: true,
                },
            },
            _count: {
                select: {
                    children: true,
                    taskLinks: true,
                },
            },
        },
        orderBy: { createdAt: "asc" },
    });
    if (opts?.flat) {
        return goals.map((goal) => withGoalProgress(goal));
    }
    return buildGoalTree(goals);
}
async function getGoal(id) {
    const goal = await prisma_1.prisma.goal.findUnique({
        where: { id },
        include: {
            children: {
                select: {
                    id: true,
                    title: true,
                    level: true,
                    status: true,
                    ownerAgentId: true,
                },
            },
            parent: { select: { id: true, title: true } },
            _count: {
                select: {
                    children: true,
                    taskLinks: true,
                },
            },
        },
    });
    return goal ? withGoalProgress(goal) : null;
}
async function createGoal(input) {
    return prisma_1.prisma.goal.create({
        data: {
            workspaceId: input.workspaceId,
            parentId: input.parentId ?? null,
            title: input.title,
            description: input.description ?? null,
            level: input.level ?? "team",
            ownerAgentId: input.ownerAgentId ?? null,
        },
    });
}
async function updateGoal(id, input) {
    const data = {};
    if (input.title !== undefined)
        data.title = input.title;
    if (input.description !== undefined)
        data.description = input.description;
    if (input.status !== undefined)
        data.status = input.status;
    if (input.level !== undefined)
        data.level = input.level;
    if (input.parentId !== undefined)
        data.parent = input.parentId ? { connect: { id: input.parentId } } : { disconnect: true };
    if (input.ownerAgentId !== undefined) {
        data.owner = input.ownerAgentId
            ? { connect: { id: input.ownerAgentId } }
            : { disconnect: true };
    }
    return prisma_1.prisma.goal.update({
        where: { id },
        data,
    });
}
async function deleteGoal(id) {
    return prisma_1.prisma.goal.delete({ where: { id } });
}
