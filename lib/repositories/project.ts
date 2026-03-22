/**
 * Project Repository
 * 
 * Data access layer for projects
 */

import { prisma } from '@/lib/prisma';
import { BaseRepository } from './base';
import type { Project } from '@prisma/client';

export interface CreateProjectDTO {
  name: string;
  direction: string;
  start: Date;
  end: Date;
  status?: string;
  progress?: number;
  budgetPlan?: number;
}

export interface UpdateProjectDTO {
  name?: string;
  status?: string;
  progress?: number;
  budgetPlan?: number;
  budgetFact?: number;
  start?: Date;
  end?: Date;
}

export interface ProjectFilters {
  status?: string;
  search?: string;
}

export class ProjectRepository extends BaseRepository<Project, CreateProjectDTO, UpdateProjectDTO> {
  async findAll(filters?: ProjectFilters): Promise<Project[]> {
    return prisma.project.findMany({
      where: {
        status: filters?.status,
        name: filters?.search
          ? { contains: filters.search }
          : undefined,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        tasks: {
          select: { id: true, status: true },
        },
      },
    });
  }

  async findById(id: string): Promise<Project | null> {
    return prisma.project.findUnique({
      where: { id },
      include: {
        tasks: true,
        risks: true,
        team: true,
      },
    });
  }

  async create(data: CreateProjectDTO): Promise<Project> {
    return prisma.project.create({
      data: {
        id: crypto.randomUUID(),
        name: data.name,
        direction: data.direction,
        start: data.start,
        end: data.end,
        status: data.status ?? 'planning',
        progress: data.progress ?? 0,
        budgetPlan: data.budgetPlan,
        updatedAt: new Date(),
      },
    });
  }

  async update(id: string, data: UpdateProjectDTO): Promise<Project> {
    return prisma.project.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.project.delete({ where: { id } });
  }

  async count(filters?: ProjectFilters): Promise<number> {
    return prisma.project.count({
      where: {
        status: filters?.status,
      },
    });
  }
}
