var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma';
function withGoalProgress(goal) {
    return Object.assign(Object.assign({}, goal), { progress: 0 });
}
function buildGoalTree(goals) {
    const map = new Map();
    for (const goal of goals) {
        map.set(goal.id, Object.assign(Object.assign({}, withGoalProgress(goal)), { subGoals: [] }));
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
export function listGoals(workspaceId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const goals = yield prisma.goal.findMany({
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
        if (opts === null || opts === void 0 ? void 0 : opts.flat) {
            return goals.map((goal) => withGoalProgress(goal));
        }
        return buildGoalTree(goals);
    });
}
export function getGoal(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const goal = yield prisma.goal.findUnique({
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
    });
}
export function createGoal(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        return prisma.goal.create({
            data: {
                workspaceId: input.workspaceId,
                parentId: (_a = input.parentId) !== null && _a !== void 0 ? _a : null,
                title: input.title,
                description: (_b = input.description) !== null && _b !== void 0 ? _b : null,
                level: (_c = input.level) !== null && _c !== void 0 ? _c : "team",
                ownerAgentId: (_d = input.ownerAgentId) !== null && _d !== void 0 ? _d : null,
            },
        });
    });
}
export function updateGoal(id, input) {
    return __awaiter(this, void 0, void 0, function* () {
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
        return prisma.goal.update({
            where: { id },
            data,
        });
    });
}
export function deleteGoal(id) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.goal.delete({ where: { id } });
    });
}
