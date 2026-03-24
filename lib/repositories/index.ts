/**
 * Repository Index
 * 
 * Export all repositories for easy access
 */

export { BaseRepository } from './base';
export { ProjectRepository } from './project';
export { TaskRepository } from './task';

// Repository factory for dependency injection
import { ProjectRepository } from './project';
import { TaskRepository } from './task';

export const repositories = {
  projects: new ProjectRepository(),
  tasks: new TaskRepository(),
};

// Type-safe repository access
export type Repositories = typeof repositories;
