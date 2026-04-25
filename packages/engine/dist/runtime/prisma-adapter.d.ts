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
        deleteMany(args?: unknown): Promise<{
            count: number;
        }>;
        count(args?: unknown): Promise<number>;
    };
    agent: {
        updateMany(args?: unknown): Promise<{
            count: number;
        }>;
    };
    $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
}
export declare function createNoopPrismaClient(): PrismaLike;
/**
 * Tries to dynamically load @prisma/client and return a new instance.
 * Returns null when the package is not installed or instantiation fails.
 *
 * @param loader - Optional override for the dynamic import (useful in tests).
 */
export declare function tryLoadPrismaClient(loader?: () => Promise<unknown>): Promise<PrismaLike | null>;
export declare function installPrismaClient(client: PrismaLike): void;
//# sourceMappingURL=prisma-adapter.d.ts.map