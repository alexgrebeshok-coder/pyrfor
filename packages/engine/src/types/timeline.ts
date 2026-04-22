/**
 * Timeline Types
 * Type definitions for project timeline visualization
 */

export interface ProjectTimeline {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  progress: number; // 0-100
  status: 'planning' | 'active' | 'completed' | 'delayed';
  milestones?: TimelineMilestone[];
}

export interface TimelineMilestone {
  id: string;
  name: string;
  date: Date;
}

export interface TimelineDataResponse {
  projects: ProjectTimeline[];
}

// Status labels in Russian
export const STATUS_LABELS: Record<ProjectTimeline['status'], string> = {
  planning: 'Планирование',
  active: 'В работе',
  completed: 'Завершён',
  delayed: 'Задержка',
};

// Color palette for status
export const STATUS_COLORS: Record<ProjectTimeline['status'], string> = {
  planning: '#6B7280',   // Gray
  active: '#3B82F6',     // Blue
  completed: '#10B981',  // Green
  delayed: '#EF4444',    // Red
};
