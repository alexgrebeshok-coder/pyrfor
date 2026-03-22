import { Project, Task, TeamMember, User, Budget, Priority, ProjectStatus, TaskStatus, ProjectDirection, UserRole } from '@/lib/types';

export function createMockBudget(overrides?: Partial<Budget>): Budget {
  return {
    planned: 1000000,
    actual: 500000,
    currency: 'RUB',
    ...overrides,
  };
}

export function createMockProject(overrides?: Partial<Project>): Project {
  return {
    id: '1',
    name: 'Test Project',
    description: 'Test project description',
    status: 'active',
    progress: 50,
    direction: 'construction',
    budget: createMockBudget(),
    dates: {
      start: '2026-01-01',
      end: '2026-12-31',
    },
    nextMilestone: {
      name: 'Milestone 1',
      date: '2026-06-01',
    },
    team: ['1', '2'],
    risks: 2,
    location: 'Test Location',
    priority: 'medium',
    health: 80,
    objectives: ['Objective 1', 'Objective 2'],
    materials: 75,
    laborProductivity: 85,
    safety: { ltifr: 0.5, trir: 1.2 },
    history: [],
    ...overrides,
  };
}

export function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: '1',
    projectId: '1',
    title: 'Test Task',
    description: 'Test task description',
    status: 'todo',
    order: 1,
    assignee: {
      id: '1',
      name: 'Test User',
      initials: 'TU',
    },
    dueDate: '2026-03-20',
    priority: 'medium',
    tags: ['tag1', 'tag2'],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function createMockTeamMember(overrides?: Partial<TeamMember>): TeamMember {
  return {
    id: '1',
    name: 'Test User',
    role: 'Test Role',
    email: 'test@example.com',
    capacity: 100,
    allocated: 50,
    projects: [],
    location: 'Test Location',
    ...overrides,
  };
}

export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: '1',
    name: 'Test User',
    email: 'test@example.com',
    role: 'PM',
    ...overrides,
  };
}
