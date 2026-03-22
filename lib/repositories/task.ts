/**
 * Task Repository
 * 
 * Data access layer for tasks
 */

import { prisma } from '@/lib/prisma';
import { BaseRepository } from './base';
import type { Task } from '@prisma/client';

export interface CreateTaskDTO {
  title: string;
  description?: string;
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  priority?: 'low' | 'medium' | 'high';
  projectId: string;
  assigneeId?: string;
  dueDate: Date;
}

export interface UpdateTaskDTO {
  title?: string;
  description?: string;
  status?: 'todo' | 'in-progress' | 'review' | 'done';
  priority?: 'low' | 'medium' | 'high';
  assigneeId?: string;
}

export interface TaskFilters {
  status?: string;
  priority?: string;
  projectId?: string;
  assigneeId?: string;
  search?: string;
}

export class TaskRepository extends BaseRepository<Task, CreateTaskDTO, UpdateTaskDTO> {
  async findAll(filters?: TaskFilters): Promise<Task[]> {
    return prisma.task.findMany({
      where: {
        status: filters?.status,
        priority: filters?.priority,
        projectId: filters?.projectId,
        assigneeId: filters?.assigneeId,
        title: filters?.search
          ? { contains: filters.search }
          : undefined,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
  }

  async findById(id: string): Promise<Task | null> {
    return prisma.task.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
      },
    });
  }

  async create(data: CreateTaskDTO): Promise<Task> {
    return prisma.task.create({
      data: {
        id: crypto.randomUUID(),
        title: data.title,
        description: data.description,
        status: data.status || 'todo',
        priority: data.priority || 'medium',
        projectId: data.projectId,
        assigneeId: data.assigneeId,
        dueDate: data.dueDate,
        updatedAt: new Date(),
      },
    });
  }

  async update(id: string, data: UpdateTaskDTO): Promise<Task> {
    return prisma.task.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.task.delete({ where: { id } });
  }

  async count(filters?: TaskFilters): Promise<number> {
    return prisma.task.count({
      where: {
        status: filters?.status,
        priority: filters?.priority,
        projectId: filters?.projectId,
      },
    });
  }

  async reorder(projectId: string, taskIds: string[]): Promise<void> {
    await prisma.$transaction(
      taskIds.map((id, index) =>
        prisma.task.update({
          where: { id },
          data: { order: index },
        })
      )
    );
  }
}
