// Agent Service — CRUD + business logic for DB-persisted agents
// Code (agents.ts) = definition source of truth; DB = runtime state
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
import { aiAgents } from '../ai/agents';
import { broadcastSSE } from '../transport/sse';
import crypto from "crypto";
// ── Helpers ──────────────────────────────────────────────────
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
}
function generateApiKey() {
    const raw = crypto.randomBytes(32).toString("hex");
    const plain = `sk-agent-${raw}`;
    const hash = crypto.createHash("sha256").update(plain).digest("hex");
    const prefix = plain.slice(0, 17); // "sk-agent-" + 8 hex
    return { plain, hash, prefix };
}
// ── Sync: code → DB (deploy-time) ───────────────────────────
export function syncAgentDefinitions(workspaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        const existing = yield prisma.agent.findMany({
            where: { workspaceId },
            select: { definitionId: true },
        });
        const existingIds = new Set(existing.map((a) => a.definitionId));
        const toCreate = aiAgents.filter((def) => def.id !== "auto-routing" && !existingIds.has(def.id));
        if (toCreate.length === 0)
            return { created: 0 };
        const categoryToRole = {
            strategic: "analyst",
            planning: "pm",
            monitoring: "engineer",
            financial: "finance",
            knowledge: "specialist",
            communication: "communicator",
            special: "specialist",
        };
        yield prisma.agent.createMany({
            data: toCreate.map((def) => {
                var _a;
                return ({
                    workspaceId,
                    definitionId: def.id,
                    name: def.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                    slug: def.id,
                    role: (_a = categoryToRole[def.category]) !== null && _a !== void 0 ? _a : "engineer",
                    status: "idle",
                    adapterType: "internal",
                });
            }),
            skipDuplicates: true,
        });
        return { created: toCreate.length };
    });
}
// ── CRUD ─────────────────────────────────────────────────────
export function listAgents(workspaceId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const where = { workspaceId };
        if (opts === null || opts === void 0 ? void 0 : opts.status)
            where.status = opts.status;
        return prisma.agent.findMany({
            where,
            include: {
                runtimeState: (_a = opts === null || opts === void 0 ? void 0 : opts.includeState) !== null && _a !== void 0 ? _a : true,
                _count: { select: { heartbeatRuns: true, taskLinks: true, reports: true } },
            },
            orderBy: { createdAt: "asc" },
        });
    });
}
export function getAgent(id) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.agent.findUnique({
            where: { id },
            include: {
                runtimeState: true,
                reportsTo: true,
                reports: true,
                _count: { select: { heartbeatRuns: true, taskLinks: true, reports: true } },
            },
        });
    });
}
export function createAgent(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const slug = input.slug || slugify(input.name);
        return prisma.agent.create({
            data: {
                workspaceId: input.workspaceId,
                definitionId: (_a = input.definitionId) !== null && _a !== void 0 ? _a : null,
                name: input.name,
                slug,
                role: (_b = input.role) !== null && _b !== void 0 ? _b : "engineer",
                reportsToId: (_c = input.reportsToId) !== null && _c !== void 0 ? _c : null,
                adapterType: (_d = input.adapterType) !== null && _d !== void 0 ? _d : "internal",
                adapterConfig: input.adapterConfig
                    ? JSON.stringify(input.adapterConfig)
                    : "{}",
                runtimeConfig: input.runtimeConfig
                    ? JSON.stringify(input.runtimeConfig)
                    : "{}",
                budgetMonthlyCents: (_e = input.budgetMonthlyCents) !== null && _e !== void 0 ? _e : 0,
                permissions: input.permissions
                    ? JSON.stringify(input.permissions)
                    : "{}",
            },
            include: { runtimeState: true },
        });
    });
}
export function updateAgent(id, input, changedBy) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        // Track fields that changed for config revision history
        const trackedFields = ["name", "role", "adapterConfig", "runtimeConfig", "permissions"];
        let oldAgent = null;
        if (changedBy) {
            const existing = yield prisma.agent.findUnique({
                where: { id },
                select: { name: true, role: true, adapterConfig: true, runtimeConfig: true, permissions: true },
            });
            if (existing)
                oldAgent = existing;
        }
        const data = {};
        if (input.name !== undefined)
            data.name = input.name;
        if (input.role !== undefined)
            data.role = input.role;
        if (input.status !== undefined)
            data.status = input.status;
        if (input.reportsToId !== undefined)
            data.reportsToId = input.reportsToId;
        if (input.adapterType !== undefined)
            data.adapterType = input.adapterType;
        if (input.adapterConfig !== undefined)
            data.adapterConfig = JSON.stringify(input.adapterConfig);
        if (input.runtimeConfig !== undefined)
            data.runtimeConfig = JSON.stringify(input.runtimeConfig);
        if (input.budgetMonthlyCents !== undefined)
            data.budgetMonthlyCents = input.budgetMonthlyCents;
        if (input.permissions !== undefined)
            data.permissions = JSON.stringify(input.permissions);
        const updated = yield prisma.agent.update({
            where: { id },
            data,
            include: { runtimeState: true },
        });
        // Record config revisions for tracked fields
        if (oldAgent && changedBy) {
            const revisions = [];
            for (const field of trackedFields) {
                if (input[field] === undefined)
                    continue;
                const oldVal = String((_a = oldAgent[field]) !== null && _a !== void 0 ? _a : "");
                const newVal = field === "name" || field === "role"
                    ? String(input[field])
                    : JSON.stringify(input[field]);
                if (oldVal !== newVal) {
                    revisions.push({
                        agentId: id,
                        field,
                        oldValue: oldVal,
                        newValue: newVal,
                        changedBy,
                    });
                }
            }
            if (revisions.length > 0) {
                yield prisma.agentConfigRevision.createMany({ data: revisions }).catch(() => { });
            }
        }
        return updated;
    });
}
export function deleteAgent(id) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.agent.delete({ where: { id } });
    });
}
// ── Org Chart ────────────────────────────────────────────────
export function getOrgChart(workspaceId) {
    return __awaiter(this, void 0, void 0, function* () {
        const agents = yield prisma.agent.findMany({
            where: { workspaceId, status: { not: "terminated" } },
            select: {
                id: true,
                name: true,
                slug: true,
                role: true,
                status: true,
                definitionId: true,
                reportsToId: true,
                budgetMonthlyCents: true,
                spentMonthlyCents: true,
            },
            orderBy: { name: "asc" },
        });
        const map = new Map();
        for (const a of agents)
            map.set(a.id, Object.assign(Object.assign({}, a), { children: [] }));
        const roots = [];
        for (const node of map.values()) {
            if (node.reportsToId && map.has(node.reportsToId)) {
                map.get(node.reportsToId).children.push(node);
            }
            else {
                roots.push(node);
            }
        }
        return roots;
    });
}
// ── API Keys ─────────────────────────────────────────────────
export function createApiKey(agentId, name) {
    return __awaiter(this, void 0, void 0, function* () {
        const { plain, hash, prefix } = generateApiKey();
        const key = yield prisma.agentApiKey.create({
            data: { agentId, name, keyHash: hash, keyPrefix: prefix },
        });
        // Return plain key ONCE — caller must show it to user
        return { id: key.id, name: key.name, keyPrefix: prefix, plainKey: plain };
    });
}
export function revokeApiKey(keyId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.agentApiKey.delete({ where: { id: keyId } });
    });
}
export function listApiKeys(agentId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.agentApiKey.findMany({
            where: { agentId },
            select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
            orderBy: { createdAt: "desc" },
        });
    });
}
export function resolveAgentByApiKey(plainKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const hash = crypto.createHash("sha256").update(plainKey).digest("hex");
        const apiKey = yield prisma.agentApiKey.findUnique({
            where: { keyHash: hash },
            include: { agent: { select: { id: true, workspaceId: true, definitionId: true } } },
        });
        if (!apiKey)
            return null;
        // Touch lastUsedAt (fire-and-forget)
        prisma.agentApiKey
            .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
            .catch(() => { });
        return {
            agentId: apiKey.agent.id,
            workspaceId: apiKey.agent.workspaceId,
            definitionId: apiKey.agent.definitionId,
        };
    });
}
// ── Status management ────────────────────────────────────────
export function pauseAgent(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const agent = yield updateAgent(id, { status: "paused" });
        broadcastSSE("agent_status_changed", { agentId: id, status: "paused" });
        return agent;
    });
}
export function resumeAgent(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const agent = yield updateAgent(id, { status: "idle" });
        broadcastSSE("agent_status_changed", { agentId: id, status: "idle" });
        return agent;
    });
}
export function terminateAgent(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const agent = yield updateAgent(id, { status: "terminated" });
        broadcastSSE("agent_status_changed", { agentId: id, status: "terminated" });
        return agent;
    });
}
