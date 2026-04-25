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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { setCronPrismaClient } from './cron/handlers.js';
import { setTelegramPrismaClient } from './telegram/handlers.js';
import { logger } from '../observability/logger.js';
// ─── Noop client ─────────────────────────────────────────────────────────────
export function createNoopPrismaClient() {
    const noopCreate = () => {
        throw new Error('[noop-prisma] create() is not available — no database configured');
    };
    return {
        project: {
            findMany: () => __awaiter(this, void 0, void 0, function* () { return []; }),
            findFirst: () => __awaiter(this, void 0, void 0, function* () { return null; }),
            count: () => __awaiter(this, void 0, void 0, function* () { return 0; }),
        },
        task: {
            findMany: () => __awaiter(this, void 0, void 0, function* () { return []; }),
            count: () => __awaiter(this, void 0, void 0, function* () { return 0; }),
            create: () => __awaiter(this, void 0, void 0, function* () { noopCreate(); }),
        },
        risk: {
            count: () => __awaiter(this, void 0, void 0, function* () { return 0; }),
        },
        memory: {
            deleteMany: () => __awaiter(this, void 0, void 0, function* () { return ({ count: 0 }); }),
            count: () => __awaiter(this, void 0, void 0, function* () { return 0; }),
        },
        agent: {
            updateMany: () => __awaiter(this, void 0, void 0, function* () { return ({ count: 0 }); }),
        },
        $queryRaw: () => __awaiter(this, void 0, void 0, function* () { return []; }),
    };
}
// ─── Dynamic loader ───────────────────────────────────────────────────────────
/**
 * Tries to dynamically load @prisma/client and return a new instance.
 * Returns null when the package is not installed or instantiation fails.
 *
 * @param loader - Optional override for the dynamic import (useful in tests).
 */
export function tryLoadPrismaClient(loader) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = yield (loader ? loader() : import('@prisma/client'));
            const PrismaClient = (_a = mod.PrismaClient) !== null && _a !== void 0 ? _a : (_b = mod.default) === null || _b === void 0 ? void 0 : _b.PrismaClient;
            if (!PrismaClient)
                return null;
            return new PrismaClient();
        }
        catch (_c) {
            return null;
        }
    });
}
// ─── Installer ────────────────────────────────────────────────────────────────
export function installPrismaClient(client) {
    setCronPrismaClient(client);
    setTelegramPrismaClient(client);
    logger.debug('[prisma-adapter] Prisma client installed into cron and telegram handlers');
}
