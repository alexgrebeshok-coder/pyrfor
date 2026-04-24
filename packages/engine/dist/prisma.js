import { PrismaClient } from '@prisma/client';
/**
 * Prisma Client Singleton
 *
 * Используется для dependency injection в тестах.
 * В продакшене создаёт один инстанс, в тестах можно мокать.
 */
const globalForPrisma = global;
export const prisma = globalForPrisma.prisma ||
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
if (process.env.NODE_ENV !== 'production')
    globalForPrisma.prisma = prisma;
