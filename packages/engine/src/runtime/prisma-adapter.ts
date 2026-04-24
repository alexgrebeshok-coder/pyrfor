/**
 * Prisma Adapter — thin shim between runtime and @prisma/client.
 *
 * Provides:
 *  - PrismaLike  — minimal interface covering only the methods used by
 *                  cron/handlers.ts and telegram/handlers.ts.
 *  - createNoopPrismaClient()  — returns empty/safe defaults for all methods.
 *  - tryLoadPrismaClient()     — dynamically imports @prisma/client; returns
 *                                null when the package is not installed.
 *  - installPrismaClient()     — wires a client into both handler modules.
 */

import { setCronPrismaClient } from './cron/handlers';
import { setTelegramPrismaClient } from './telegram/handlers';
import { logger } from '../observability/logger';

// ─── Minimal interface ────────────────────────────────────────────────────────

export interface PrismaLike {
  project: {
    findMany(args?: unknown): Promise<unknown[]>;
    findFirst(args?: unknown): Promise<unknown | null>;
    count(args?: unknown): Promise<number>;
  };
  task: {
    findMany(args?: unknown): Promise<unknown[]>;
    count(args?: unknown): Promise<number>;
    create(args?: unknown): Promise<unknown>;
  };
  risk: {
    count(args?: unknown): Promise<number>;
  };
  memory: {
    deleteMany(args?: unknown): Promise<{ count: number }>;
    count(args?: unknown): Promise<number>;
  };
  agent: {
    updateMany(args?: unknown): Promise<{ count: number }>;
  };
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
}

// ─── Noop client ─────────────────────────────────────────────────────────────

export function createNoopPrismaClient(): PrismaLike {
  const noopCreate = (): never => {
    throw new Error('[noop-prisma] create() is not available — no database configured');
  };

  return {
    project: {
      findMany: async () => [],
      findFirst: async () => null,
      count: async () => 0,
    },
    task: {
      findMany: async () => [],
      count: async () => 0,
      create: async () => { noopCreate(); },
    },
    risk: {
      count: async () => 0,
    },
    memory: {
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    agent: {
      updateMany: async () => ({ count: 0 }),
    },
    $queryRaw: async () => [],
  };
}

// ─── Dynamic loader ───────────────────────────────────────────────────────────

/**
 * Tries to dynamically load @prisma/client and return a new instance.
 * Returns null when the package is not installed or instantiation fails.
 *
 * @param loader - Optional override for the dynamic import (useful in tests).
 */
export async function tryLoadPrismaClient(
  loader?: () => Promise<unknown>,
): Promise<PrismaLike | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (loader ? loader() : import('@prisma/client')) as any;
    const PrismaClient = mod.PrismaClient ?? mod.default?.PrismaClient;
    if (!PrismaClient) return null;
    return new PrismaClient() as PrismaLike;
  } catch {
    return null;
  }
}

// ─── Installer ────────────────────────────────────────────────────────────────

export function installPrismaClient(client: PrismaLike): void {
  setCronPrismaClient(client);
  setTelegramPrismaClient(client);
  logger.debug('[prisma-adapter] Prisma client installed into cron and telegram handlers');
}
