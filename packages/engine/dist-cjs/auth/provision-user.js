"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.provisionAuthUser = provisionAuthUser;
const crypto_1 = require("crypto");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
function buildSlug(value) {
    return (value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "ceoclaw-test");
}
function buildInitials(value) {
    const initials = value
        .trim()
        .split(/\s+/)
        .map((part) => part[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase();
    return initials || "HQ";
}
async function hashPassword(password, saltRounds = 10) {
    return bcryptjs_1.default.hash(password, saltRounds);
}
async function ensureOrganizationAndWorkspace(prisma, organizationName, workspaceName, workspaceKey) {
    const now = new Date();
    const organization = (await prisma.organization.findFirst({
        select: {
            id: true,
        },
        orderBy: { createdAt: "asc" },
    })) ??
        (await prisma.organization.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                slug: buildSlug(organizationName),
                name: organizationName,
                description: "Provisioned for production test login.",
                updatedAt: now,
            },
            select: {
                id: true,
            },
        }));
    const workspace = (await prisma.workspace.findFirst({
        select: {
            id: true,
        },
        where: { organizationId: organization.id },
        orderBy: { createdAt: "asc" },
    })) ??
        (await prisma.workspace.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                organizationId: organization.id,
                key: workspaceKey,
                name: workspaceName,
                initials: buildInitials(workspaceName),
                description: "Default workspace for production test login.",
                isDefault: true,
                updatedAt: now,
            },
            select: {
                id: true,
            },
        }));
    return { organization, workspace };
}
async function provisionAuthUser(prisma, input) {
    const now = new Date();
    const role = input.role?.trim() || "EXEC";
    const displayName = input.name?.trim() || input.email.split("@")[0] || "CEOClaw Test User";
    const organizationName = input.organizationName?.trim() || "CEOClaw Test Organization";
    const workspaceName = input.workspaceName?.trim() || "Main Workspace";
    const workspaceKey = input.workspaceKey?.trim() || "main";
    const hashedPassword = await hashPassword(input.password, 10);
    const { organization, workspace } = await ensureOrganizationAndWorkspace(prisma, organizationName, workspaceName, workspaceKey);
    const user = await prisma.user.upsert({
        where: { email: input.email },
        update: {
            password: hashedPassword,
            name: displayName,
            emailVerified: now,
            updatedAt: now,
        },
        create: {
            id: (0, crypto_1.randomUUID)(),
            email: input.email,
            password: hashedPassword,
            name: displayName,
            emailVerified: now,
            updatedAt: now,
        },
        select: {
            id: true,
            email: true,
            name: true,
            emailVerified: true,
        },
    });
    const membership = (await prisma.membership.findFirst({
        select: {
            id: true,
            role: true,
            email: true,
            displayName: true,
        },
        where: {
            userId: user.id,
            organizationId: organization.id,
        },
    })) ??
        (await prisma.membership.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                organizationId: organization.id,
                userId: user.id,
                email: input.email,
                displayName,
                role,
                updatedAt: now,
            },
            select: {
                id: true,
                role: true,
                email: true,
                displayName: true,
            },
        }));
    if (membership.role !== role || membership.email !== input.email || membership.displayName !== displayName) {
        await prisma.membership.update({
            where: { id: membership.id },
            data: {
                email: input.email,
                displayName,
                role,
                updatedAt: now,
            },
        });
    }
    const workspaceMembership = await prisma.workspaceMembership.findFirst({
        select: {
            id: true,
            role: true,
        },
        where: {
            workspaceId: workspace.id,
            membershipId: membership.id,
        },
    });
    if (!workspaceMembership) {
        await prisma.workspaceMembership.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                workspaceId: workspace.id,
                membershipId: membership.id,
                role,
            },
        });
    }
    else if (workspaceMembership.role !== role) {
        await prisma.workspaceMembership.update({
            where: { id: workspaceMembership.id },
            data: { role },
        });
    }
    return {
        ...user,
        role,
    };
}
