"use strict";
// Agent Service — CRUD + business logic for DB-persisted agents
// Code (agents.ts) = definition source of truth; DB = runtime state
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncAgentDefinitions = syncAgentDefinitions;
exports.listAgents = listAgents;
exports.getAgent = getAgent;
exports.createAgent = createAgent;
exports.updateAgent = updateAgent;
exports.deleteAgent = deleteAgent;
exports.getOrgChart = getOrgChart;
exports.createApiKey = createApiKey;
exports.revokeApiKey = revokeApiKey;
exports.listApiKeys = listApiKeys;
exports.resolveAgentByApiKey = resolveAgentByApiKey;
exports.pauseAgent = pauseAgent;
exports.resumeAgent = resumeAgent;
exports.terminateAgent = terminateAgent;
const prisma_1 = require("../prisma");
const agents_1 = require("../ai/agents");
const sse_1 = require("../transport/sse");
const crypto_1 = __importDefault(require("crypto"));
// ── Helpers ──────────────────────────────────────────────────
function slugify(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9а-яё]+/gi, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
}
function generateApiKey() {
    const raw = crypto_1.default.randomBytes(32).toString("hex");
    const plain = `sk-agent-${raw}`;
    const hash = crypto_1.default.createHash("sha256").update(plain).digest("hex");
    const prefix = plain.slice(0, 17); // "sk-agent-" + 8 hex
    return { plain, hash, prefix };
}
// ── Sync: code → DB (deploy-time) ───────────────────────────
async function syncAgentDefinitions(workspaceId) {
    const existing = await prisma_1.prisma.agent.findMany({
        where: { workspaceId },
        select: { definitionId: true },
    });
    const existingIds = new Set(existing.map((a) => a.definitionId));
    const toCreate = agents_1.aiAgents.filter((def) => def.id !== "auto-routing" && !existingIds.has(def.id));
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
    await prisma_1.prisma.agent.createMany({
        data: toCreate.map((def) => ({
            workspaceId,
            definitionId: def.id,
            name: def.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            slug: def.id,
            role: categoryToRole[def.category] ?? "engineer",
            status: "idle",
            adapterType: "internal",
        })),
        skipDuplicates: true,
    });
    return { created: toCreate.length };
}
// ── CRUD ─────────────────────────────────────────────────────
async function listAgents(workspaceId, opts) {
    const where = { workspaceId };
    if (opts?.status)
        where.status = opts.status;
    return prisma_1.prisma.agent.findMany({
        where,
        include: {
            runtimeState: opts?.includeState ?? true,
            _count: { select: { heartbeatRuns: true, taskLinks: true, reports: true } },
        },
        orderBy: { createdAt: "asc" },
    });
}
async function getAgent(id) {
    return prisma_1.prisma.agent.findUnique({
        where: { id },
        include: {
            runtimeState: true,
            reportsTo: true,
            reports: true,
            _count: { select: { heartbeatRuns: true, taskLinks: true, reports: true } },
        },
    });
}
async function createAgent(input) {
    const slug = input.slug || slugify(input.name);
    return prisma_1.prisma.agent.create({
        data: {
            workspaceId: input.workspaceId,
            definitionId: input.definitionId ?? null,
            name: input.name,
            slug,
            role: input.role ?? "engineer",
            reportsToId: input.reportsToId ?? null,
            adapterType: input.adapterType ?? "internal",
            adapterConfig: input.adapterConfig
                ? JSON.stringify(input.adapterConfig)
                : "{}",
            runtimeConfig: input.runtimeConfig
                ? JSON.stringify(input.runtimeConfig)
                : "{}",
            budgetMonthlyCents: input.budgetMonthlyCents ?? 0,
            permissions: input.permissions
                ? JSON.stringify(input.permissions)
                : "{}",
        },
        include: { runtimeState: true },
    });
}
async function updateAgent(id, input, changedBy) {
    // Track fields that changed for config revision history
    const trackedFields = ["name", "role", "adapterConfig", "runtimeConfig", "permissions"];
    let oldAgent = null;
    if (changedBy) {
        const existing = await prisma_1.prisma.agent.findUnique({
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
    const updated = await prisma_1.prisma.agent.update({
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
            const oldVal = String(oldAgent[field] ?? "");
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
            await prisma_1.prisma.agentConfigRevision.createMany({ data: revisions }).catch(() => { });
        }
    }
    return updated;
}
async function deleteAgent(id) {
    return prisma_1.prisma.agent.delete({ where: { id } });
}
// ── Org Chart ────────────────────────────────────────────────
async function getOrgChart(workspaceId) {
    const agents = await prisma_1.prisma.agent.findMany({
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
        map.set(a.id, { ...a, children: [] });
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
}
// ── API Keys ─────────────────────────────────────────────────
async function createApiKey(agentId, name) {
    const { plain, hash, prefix } = generateApiKey();
    const key = await prisma_1.prisma.agentApiKey.create({
        data: { agentId, name, keyHash: hash, keyPrefix: prefix },
    });
    // Return plain key ONCE — caller must show it to user
    return { id: key.id, name: key.name, keyPrefix: prefix, plainKey: plain };
}
async function revokeApiKey(keyId) {
    return prisma_1.prisma.agentApiKey.delete({ where: { id: keyId } });
}
async function listApiKeys(agentId) {
    return prisma_1.prisma.agentApiKey.findMany({
        where: { agentId },
        select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    });
}
async function resolveAgentByApiKey(plainKey) {
    const hash = crypto_1.default.createHash("sha256").update(plainKey).digest("hex");
    const apiKey = await prisma_1.prisma.agentApiKey.findUnique({
        where: { keyHash: hash },
        include: { agent: { select: { id: true, workspaceId: true, definitionId: true } } },
    });
    if (!apiKey)
        return null;
    // Touch lastUsedAt (fire-and-forget)
    prisma_1.prisma.agentApiKey
        .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
        .catch(() => { });
    return {
        agentId: apiKey.agent.id,
        workspaceId: apiKey.agent.workspaceId,
        definitionId: apiKey.agent.definitionId,
    };
}
// ── Status management ────────────────────────────────────────
async function pauseAgent(id) {
    const agent = await updateAgent(id, { status: "paused" });
    (0, sse_1.broadcastSSE)("agent_status_changed", { agentId: id, status: "paused" });
    return agent;
}
async function resumeAgent(id) {
    const agent = await updateAgent(id, { status: "idle" });
    (0, sse_1.broadcastSSE)("agent_status_changed", { agentId: id, status: "idle" });
    return agent;
}
async function terminateAgent(id) {
    const agent = await updateAgent(id, { status: "terminated" });
    (0, sse_1.broadcastSSE)("agent_status_changed", { agentId: id, status: "terminated" });
    return agent;
}
