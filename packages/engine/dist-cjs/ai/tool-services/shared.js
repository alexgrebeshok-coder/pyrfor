"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateToolEntityId = generateToolEntityId;
exports.resolveActiveProjectId = resolveActiveProjectId;
const prisma_1 = require("../../prisma");
function generateToolEntityId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
async function resolveActiveProjectId(projectId) {
    if (projectId) {
        return projectId;
    }
    const first = await prisma_1.prisma.project.findFirst({
        where: { status: { not: "archived" } },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
    });
    return first?.id ?? null;
}
