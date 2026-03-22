/**
 * API Contract Tests
 * 
 * Tests for API response schemas using Zod validation
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Response schemas
const ProjectResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['planning', 'active', 'on-hold', 'completed']),
  progress: z.number().min(0).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

const TaskResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['todo', 'in-progress', 'review', 'done']),
  priority: z.enum(['low', 'medium', 'high']),
  projectId: z.string(),
  createdAt: z.string().datetime(),
});

const MemoryResponseSchema = z.object({
  id: z.string(),
  type: z.enum(['long_term', 'episodic', 'procedural']),
  category: z.enum(['project', 'contact', 'skill', 'fact', 'decision', 'agent', 'chat']),
  key: z.string(),
  value: z.any(),
  confidence: z.number().min(0).max(100).optional(),
  createdAt: z.string().datetime(),
});

const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  statusCode: z.number().optional(),
});

describe('API Contracts', () => {
  describe('Projects API', () => {
    it('should validate project response schema', () => {
      const validProject = {
        id: 'proj-123',
        name: 'Test Project',
        status: 'active',
        progress: 75,
        createdAt: '2024-01-01T00:00:00Z',
      };

      const result = ProjectResponseSchema.safeParse(validProject);
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', () => {
      const invalidProject = {
        id: 'proj-123',
        name: 'Test Project',
        status: 'invalid-status',
        progress: 75,
        createdAt: '2024-01-01T00:00:00Z',
      };
      const result = ProjectResponseSchema.safeParse(invalidProject);
      expect(result.success).toBe(false);
    });

    it('should reject progress out of range', () => {
      const invalidProgress = {
        id: 'proj-123',
        name: 'Test Project',
        status: 'active',
        progress: 150, // Max is 100
        createdAt: '2024-01-01T00:00:00Z',
      };
      const result = ProjectResponseSchema.safeParse(invalidProgress);
      expect(result.success).toBe(false);
    });
  });

  describe('Tasks API', () => {
    it('should validate task response schema', () => {
      const validTask = {
        id: 'task-456',
        title: 'Test Task',
        status: 'in-progress',
        priority: 'high',
        projectId: 'proj-123',
        createdAt: '2024-01-01T00:00:00Z',
      };
      const result = TaskResponseSchema.safeParse(validTask);
      expect(result.success).toBe(true);
    });

    it('should reject invalid priority', () => {
      const invalidTask = {
        id: 'task-456',
        title: 'Test Task',
        status: 'in-progress',
        priority: 'critical', // Not in enum
        projectId: 'proj-123',
        createdAt: '2024-01-01T00:00:00Z',
      };
      const result = TaskResponseSchema.safeParse(invalidTask);
      expect(result.success).toBe(false);
    });
  });

  describe('Memory API', () => {
    it('should validate memory response schema', () => {
      const validMemory = {
        id: 'mem-789',
        type: 'episodic',
        category: 'project',
        key: 'test-key',
        value: { text: 'Test value' },
        confidence: 90,
        createdAt: '2024-01-01T00:00:00Z',
      };
      const result = MemoryResponseSchema.safeParse(validMemory);
      expect(result.success).toBe(true);
    });

    it('should accept confidence as optional', () => {
      const memoryWithoutConfidence = {
        id: 'mem-789',
        type: 'procedural',
        category: 'skill',
        key: 'test-skill',
        value: 'Test skill',
        createdAt: '2024-01-01T00:00:00Z',
      };
      const result = MemoryResponseSchema.safeParse(memoryWithoutConfidence);
      expect(result.success).toBe(true);
    });
  });

  describe('Error Responses', () => {
    it('should validate error response schema', () => {
      const validError = {
        error: 'Not found',
        message: 'Project not found',
        statusCode: 404,
      };
      const result = ErrorResponseSchema.safeParse(validError);
      expect(result.success).toBe(true);
    });

    it('should accept minimal error response', () => {
      const minimalError = {
        error: 'Validation failed',
      };
      const result = ErrorResponseSchema.safeParse(minimalError);
      expect(result.success).toBe(true);
    });
  });
});
