/**
 * Base Repository Pattern
 *
 * Provides a consistent interface for data access across the application
 */

import { prisma } from '@/lib/prisma';

export abstract class BaseRepository<T, CreateDTO, UpdateDTO> {
  protected prisma = prisma;

  abstract findAll(filters?: Record<string, unknown>): Promise<T[]>;
  abstract findById(id: string): Promise<T | null>;
  abstract create(data: CreateDTO): Promise<T>;
  abstract update(id: string, data: UpdateDTO): Promise<T>;
  abstract delete(id: string): Promise<void>;
}

/**
 * Repository Factory
 *
 * Creates repository instances with shared Prisma client
 */
export class RepositoryFactory {
  static getPrisma() {
    return prisma;
  }
}
