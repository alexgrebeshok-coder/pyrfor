/**
 * Prisma Client - Singleton with Turso support
 *
 * Prevents exhausting database connections in development
 * Supports Turso/libsql in production
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function getPrismaClient(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  // Check if we're using Turso (production on Vercel)
  if (process.env.TURSO_DATABASE_URL && process.env.VERCEL) {
    // Dynamic import for Turso adapter
    // Note: This requires the adapter to be pre-configured
    try {
      // @ts-expect-error - Dynamic import for Turso
      const { PrismaLibSQL } = require('@prisma/adapter-libsql');
      // @ts-expect-error - Dynamic import for libsql
      const { createClient } = require('@libsql/client');
      
      const libsql = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      
      const adapter = new PrismaLibSQL(libsql);
      
      globalForPrisma.prisma = new PrismaClient({
        adapter,
        log: ['error'],
      });
      
      return globalForPrisma.prisma;
    } catch (error) {
      console.error('Failed to initialize Turso adapter:', error);
      // Fallback to regular PrismaClient
    }
  }

  // Local development with SQLite or fallback
  globalForPrisma.prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

  return globalForPrisma.prisma;
}

export const prisma = getPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
