import { prisma } from '../prisma';

import type { AgentRuntimeConfig, CircuitState } from "./types";

export class AgentCircuitOpenError extends Error {
  constructor(message: string, public readonly openUntil?: Date | null) {
    super(message);
    this.name = "AgentCircuitOpenError";
  }
}

export interface AgentCircuitSnapshot {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: Date | null;
  openUntil: Date | null;
}

type RuntimeStateRecord = {
  consecutiveFailures: number;
  circuitState: string;
  circuitOpenedAt: Date | null;
  circuitOpenUntil: Date | null;
};

type CircuitPrisma = {
  agentRuntimeState: {
    findUnique(args: {
      where: { agentId: string };
      select: {
        consecutiveFailures: true;
        circuitState: true;
        circuitOpenedAt: true;
        circuitOpenUntil: true;
      };
    }): Promise<RuntimeStateRecord | null>;
    upsert(args: {
      where: { agentId: string };
      create: {
        agentId: string;
        consecutiveFailures: number;
        circuitState: string;
        circuitOpenedAt?: Date | null;
        circuitOpenUntil?: Date | null;
      };
      update: {
        consecutiveFailures?: number;
        circuitState?: string;
        circuitOpenedAt?: Date | null;
        circuitOpenUntil?: Date | null;
      };
    }): Promise<unknown>;
  };
};

function parseRuntimeConfig(
  runtimeConfig?: AgentRuntimeConfig | string | null
): AgentRuntimeConfig {
  if (!runtimeConfig) {
    return {};
  }

  if (typeof runtimeConfig === "string") {
    try {
      const parsed = JSON.parse(runtimeConfig);
      return parsed && typeof parsed === "object"
        ? (parsed as AgentRuntimeConfig)
        : {};
    } catch {
      return {};
    }
  }

  return runtimeConfig;
}

function getCircuitSettings(runtimeConfig?: AgentRuntimeConfig | string | null) {
  const parsed = parseRuntimeConfig(runtimeConfig);
  return {
    failureThreshold: Math.max(parsed.circuitFailureThreshold ?? 3, 1),
    cooldownMs: Math.max((parsed.circuitCooldownSec ?? 300) * 1000, 1_000),
  };
}

function normalizeSnapshot(record: RuntimeStateRecord | null): AgentCircuitSnapshot {
  return {
    state:
      record?.circuitState === "open" || record?.circuitState === "half-open"
        ? (record.circuitState as CircuitState)
        : "closed",
    consecutiveFailures: record?.consecutiveFailures ?? 0,
    openedAt: record?.circuitOpenedAt ?? null,
    openUntil: record?.circuitOpenUntil ?? null,
  };
}

export function isAgentCircuitOpen(
  snapshot: AgentCircuitSnapshot,
  now = new Date()
) {
  return snapshot.state === "open" && !!snapshot.openUntil && snapshot.openUntil > now;
}

export async function getAgentCircuitSnapshot(
  agentId: string,
  prismaClient: CircuitPrisma = prisma as unknown as CircuitPrisma
): Promise<AgentCircuitSnapshot> {
  const runtimeState = await prismaClient.agentRuntimeState.findUnique({
    where: { agentId },
    select: {
      consecutiveFailures: true,
      circuitState: true,
      circuitOpenedAt: true,
      circuitOpenUntil: true,
    },
  });

  return normalizeSnapshot(runtimeState);
}

export async function ensureAgentCircuitReady(
  agentId: string,
  runtimeConfig?: AgentRuntimeConfig | string | null,
  prismaClient: CircuitPrisma = prisma as unknown as CircuitPrisma
): Promise<AgentCircuitSnapshot> {
  const snapshot = await getAgentCircuitSnapshot(agentId, prismaClient);
  const now = new Date();

  if (isAgentCircuitOpen(snapshot, now)) {
    throw new AgentCircuitOpenError(
      `Circuit open for agent ${agentId} until ${snapshot.openUntil?.toISOString() ?? "cooldown ends"}.`,
      snapshot.openUntil
    );
  }

  if (snapshot.state === "open" || snapshot.state === "half-open") {
    await prismaClient.agentRuntimeState.upsert({
      where: { agentId },
      create: {
        agentId,
        consecutiveFailures: snapshot.consecutiveFailures,
        circuitState: "half-open",
        circuitOpenedAt: snapshot.openedAt,
        circuitOpenUntil: null,
      },
      update: {
        circuitState: "half-open",
        circuitOpenUntil: null,
      },
    });

    return {
      ...snapshot,
      state: "half-open",
      openUntil: null,
    };
  }

  return snapshot;
}

export async function recordAgentCircuitSuccess(
  agentId: string,
  prismaClient: CircuitPrisma = prisma as unknown as CircuitPrisma
) {
  await prismaClient.agentRuntimeState.upsert({
    where: { agentId },
    create: {
      agentId,
      consecutiveFailures: 0,
      circuitState: "closed",
      circuitOpenedAt: null,
      circuitOpenUntil: null,
    },
    update: {
      consecutiveFailures: 0,
      circuitState: "closed",
      circuitOpenedAt: null,
      circuitOpenUntil: null,
    },
  });
}

export async function recordAgentCircuitFailure(
  agentId: string,
  runtimeConfig?: AgentRuntimeConfig | string | null,
  prismaClient: CircuitPrisma = prisma as unknown as CircuitPrisma
): Promise<AgentCircuitSnapshot> {
  const current = await getAgentCircuitSnapshot(agentId, prismaClient);
  const settings = getCircuitSettings(runtimeConfig);
  const nextFailures = current.consecutiveFailures + 1;
  const now = new Date();
  const shouldOpen =
    current.state === "half-open" || nextFailures >= settings.failureThreshold;
  const openUntil = shouldOpen ? new Date(now.getTime() + settings.cooldownMs) : null;
  const nextState: CircuitState = shouldOpen ? "open" : "closed";

  await prismaClient.agentRuntimeState.upsert({
    where: { agentId },
    create: {
      agentId,
      consecutiveFailures: nextFailures,
      circuitState: nextState,
      circuitOpenedAt: shouldOpen ? now : null,
      circuitOpenUntil: openUntil,
    },
    update: {
      consecutiveFailures: nextFailures,
      circuitState: nextState,
      circuitOpenedAt: shouldOpen ? now : null,
      circuitOpenUntil: openUntil,
    },
  });

  return {
    state: nextState,
    consecutiveFailures: nextFailures,
    openedAt: shouldOpen ? now : null,
    openUntil,
  };
}
