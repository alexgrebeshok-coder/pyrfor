import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  // Check if we're using Turso (production on Vercel)
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN && typeof window === 'undefined') {
    try {
      // Dynamic import for Turso adapter (server-side only)
      // @ts-expect-error - Dynamic import for server-only module
      const { PrismaLibSQL } = require('@prisma/adapter-libsql');
      // @ts-expect-error - Dynamic import for server-only module
      const { createClient } = require('@libsql/client');
      
      const libsql = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      
      const adapter = new PrismaLibSQL(libsql);
      
      return new PrismaClient({
        adapter,
        log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
      });
    } catch (error) {
      console.error('Failed to initialize Turso adapter, falling back:', error);
    }
  }
  
  // Local development with SQLite or fallback
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

export const prisma =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
