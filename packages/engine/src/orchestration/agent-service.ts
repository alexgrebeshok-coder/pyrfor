// Agent Service — CRUD + business logic for DB-persisted agents
// Code (agents.ts) = definition source of truth; DB = runtime state

import { prisma } from "@/lib/prisma";
import { aiAgents } from "@/lib/ai/agents";
import { broadcastSSE } from "@/lib/sse";
import crypto from "crypto";
import type {
  CreateAgentInput,
  UpdateAgentInput,
  AgentWithState,
  AgentStatus,
} from "./types";

// ── Helpers ──────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function generateApiKey(): { plain: string; hash: string; prefix: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  const plain = `sk-agent-${raw}`;
  const hash = crypto.createHash("sha256").update(plain).digest("hex");
  const prefix = plain.slice(0, 17); // "sk-agent-" + 8 hex
  return { plain, hash, prefix };
}

// ── Sync: code → DB (deploy-time) ───────────────────────────

export async function syncAgentDefinitions(workspaceId: string) {
  const existing = await prisma.agent.findMany({
    where: { workspaceId },
    select: { definitionId: true },
  });
  const existingIds = new Set(existing.map((a) => a.definitionId));

  const toCreate = aiAgents.filter(
    (def) => def.id !== "auto-routing" && !existingIds.has(def.id)
  );

  if (toCreate.length === 0) return { created: 0 };

  const categoryToRole: Record<string, string> = {
    strategic: "analyst",
    planning: "pm",
    monitoring: "engineer",
    financial: "finance",
    knowledge: "specialist",
    communication: "communicator",
    special: "specialist",
  };

  await prisma.agent.createMany({
    data: toCreate.map((def) => ({
      workspaceId,
      definitionId: def.id,
      name: def.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      slug: def.id,
      role: categoryToRole[def.category] ?? "engineer",
      status: "idle" as const,
      adapterType: "internal",
    })),
    skipDuplicates: true,
  });

  return { created: toCreate.length };
}

// ── CRUD ─────────────────────────────────────────────────────

export async function listAgents(
  workspaceId: string,
  opts?: { status?: AgentStatus; includeState?: boolean }
): Promise<AgentWithState[]> {
  const where: Record<string, unknown> = { workspaceId };
  if (opts?.status) where.status = opts.status;

  return prisma.agent.findMany({
    where,
    include: {
      runtimeState: opts?.includeState ?? true,
      _count: { select: { heartbeatRuns: true, taskLinks: true, reports: true } },
    },
    orderBy: { createdAt: "asc" },
  }) as Promise<AgentWithState[]>;
}

export async function getAgent(id: string): Promise<AgentWithState | null> {
  return prisma.agent.findUnique({
    where: { id },
    include: {
      runtimeState: true,
      reportsTo: true,
      reports: true,
      _count: { select: { heartbeatRuns: true, taskLinks: true, reports: true } },
    },
  }) as Promise<AgentWithState | null>;
}

export async function createAgent(input: CreateAgentInput) {
  const slug = input.slug || slugify(input.name);

  return prisma.agent.create({
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

export async function updateAgent(id: string, input: UpdateAgentInput, changedBy?: string) {
  // Track fields that changed for config revision history
  const trackedFields = ["name", "role", "adapterConfig", "runtimeConfig", "permissions"] as const;
  let oldAgent: Record<string, unknown> | null = null;

  if (changedBy) {
    const existing = await prisma.agent.findUnique({
      where: { id },
      select: { name: true, role: true, adapterConfig: true, runtimeConfig: true, permissions: true },
    });
    if (existing) oldAgent = existing as Record<string, unknown>;
  }

  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.role !== undefined) data.role = input.role;
  if (input.status !== undefined) data.status = input.status;
  if (input.reportsToId !== undefined) data.reportsToId = input.reportsToId;
  if (input.adapterType !== undefined) data.adapterType = input.adapterType;
  if (input.adapterConfig !== undefined)
    data.adapterConfig = JSON.stringify(input.adapterConfig);
  if (input.runtimeConfig !== undefined)
    data.runtimeConfig = JSON.stringify(input.runtimeConfig);
  if (input.budgetMonthlyCents !== undefined)
    data.budgetMonthlyCents = input.budgetMonthlyCents;
  if (input.permissions !== undefined)
    data.permissions = JSON.stringify(input.permissions);

  const updated = await prisma.agent.update({
    where: { id },
    data,
    include: { runtimeState: true },
  });

  // Record config revisions for tracked fields
  if (oldAgent && changedBy) {
    const revisions: Array<{
      agentId: string;
      field: string;
      oldValue: string | null;
      newValue: string | null;
      changedBy: string;
    }> = [];

    for (const field of trackedFields) {
      if (input[field] === undefined) continue;
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
      await prisma.agentConfigRevision.createMany({ data: revisions }).catch(() => {});
    }
  }

  return updated;
}

export async function deleteAgent(id: string) {
  return prisma.agent.delete({ where: { id } });
}

// ── Org Chart ────────────────────────────────────────────────

export async function getOrgChart(workspaceId: string) {
  const agents = await prisma.agent.findMany({
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

  // Build tree: roots are agents with no reportsTo
  type OrgNode = (typeof agents)[number] & { children: OrgNode[] };
  const map = new Map<string, OrgNode>();
  for (const a of agents) map.set(a.id, { ...a, children: [] });

  const roots: OrgNode[] = [];
  for (const node of map.values()) {
    if (node.reportsToId && map.has(node.reportsToId)) {
      map.get(node.reportsToId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ── API Keys ─────────────────────────────────────────────────

export async function createApiKey(agentId: string, name: string) {
  const { plain, hash, prefix } = generateApiKey();

  const key = await prisma.agentApiKey.create({
    data: { agentId, name, keyHash: hash, keyPrefix: prefix },
  });

  // Return plain key ONCE — caller must show it to user
  return { id: key.id, name: key.name, keyPrefix: prefix, plainKey: plain };
}

export async function revokeApiKey(keyId: string) {
  return prisma.agentApiKey.delete({ where: { id: keyId } });
}

export async function listApiKeys(agentId: string) {
  return prisma.agentApiKey.findMany({
    where: { agentId },
    select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function resolveAgentByApiKey(
  plainKey: string
): Promise<{ agentId: string; workspaceId: string; definitionId: string | null } | null> {
  const hash = crypto.createHash("sha256").update(plainKey).digest("hex");

  const apiKey = await prisma.agentApiKey.findUnique({
    where: { keyHash: hash },
    include: { agent: { select: { id: true, workspaceId: true, definitionId: true } } },
  });

  if (!apiKey) return null;

  // Touch lastUsedAt (fire-and-forget)
  prisma.agentApiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    agentId: apiKey.agent.id,
    workspaceId: apiKey.agent.workspaceId,
    definitionId: apiKey.agent.definitionId,
  };
}

// ── Status management ────────────────────────────────────────

export async function pauseAgent(id: string) {
  const agent = await updateAgent(id, { status: "paused" });
  broadcastSSE("agent_status_changed", { agentId: id, status: "paused" });
  return agent;
}

export async function resumeAgent(id: string) {
  const agent = await updateAgent(id, { status: "idle" });
  broadcastSSE("agent_status_changed", { agentId: id, status: "idle" });
  return agent;
}

export async function terminateAgent(id: string) {
  const agent = await updateAgent(id, { status: "terminated" });
  broadcastSSE("agent_status_changed", { agentId: id, status: "terminated" });
  return agent;
}
