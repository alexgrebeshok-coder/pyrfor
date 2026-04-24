var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
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
        .map((part) => { var _a; return (_a = part[0]) !== null && _a !== void 0 ? _a : ""; })
        .join("")
        .slice(0, 2)
        .toUpperCase();
    return initials || "HQ";
}
export function hashPassword(password_1) {
    return __awaiter(this, arguments, void 0, function* (password, saltRounds = 10) {
        return bcrypt.hash(password, saltRounds);
    });
}
function ensureOrganizationAndWorkspace(prisma, organizationName, workspaceName, workspaceKey) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const now = new Date();
        const organization = (_a = (yield prisma.organization.findFirst({
            select: {
                id: true,
            },
            orderBy: { createdAt: "asc" },
        }))) !== null && _a !== void 0 ? _a : (yield prisma.organization.create({
            data: {
                id: randomUUID(),
                slug: buildSlug(organizationName),
                name: organizationName,
                description: "Provisioned for production test login.",
                updatedAt: now,
            },
            select: {
                id: true,
            },
        }));
        const workspace = (_b = (yield prisma.workspace.findFirst({
            select: {
                id: true,
            },
            where: { organizationId: organization.id },
            orderBy: { createdAt: "asc" },
        }))) !== null && _b !== void 0 ? _b : (yield prisma.workspace.create({
            data: {
                id: randomUUID(),
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
    });
}
export function provisionAuthUser(prisma, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const now = new Date();
        const role = ((_a = input.role) === null || _a === void 0 ? void 0 : _a.trim()) || "EXEC";
        const displayName = ((_b = input.name) === null || _b === void 0 ? void 0 : _b.trim()) || input.email.split("@")[0] || "CEOClaw Test User";
        const organizationName = ((_c = input.organizationName) === null || _c === void 0 ? void 0 : _c.trim()) || "CEOClaw Test Organization";
        const workspaceName = ((_d = input.workspaceName) === null || _d === void 0 ? void 0 : _d.trim()) || "Main Workspace";
        const workspaceKey = ((_e = input.workspaceKey) === null || _e === void 0 ? void 0 : _e.trim()) || "main";
        const hashedPassword = yield hashPassword(input.password, 10);
        const { organization, workspace } = yield ensureOrganizationAndWorkspace(prisma, organizationName, workspaceName, workspaceKey);
        const user = yield prisma.user.upsert({
            where: { email: input.email },
            update: {
                password: hashedPassword,
                name: displayName,
                emailVerified: now,
                updatedAt: now,
            },
            create: {
                id: randomUUID(),
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
        const membership = (_f = (yield prisma.membership.findFirst({
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
        }))) !== null && _f !== void 0 ? _f : (yield prisma.membership.create({
            data: {
                id: randomUUID(),
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
            yield prisma.membership.update({
                where: { id: membership.id },
                data: {
                    email: input.email,
                    displayName,
                    role,
                    updatedAt: now,
                },
            });
        }
        const workspaceMembership = yield prisma.workspaceMembership.findFirst({
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
            yield prisma.workspaceMembership.create({
                data: {
                    id: randomUUID(),
                    workspaceId: workspace.id,
                    membershipId: membership.id,
                    role,
                },
            });
        }
        else if (workspaceMembership.role !== role) {
            yield prisma.workspaceMembership.update({
                where: { id: workspaceMembership.id },
                data: { role },
            });
        }
        return Object.assign(Object.assign({}, user), { role });
    });
}
